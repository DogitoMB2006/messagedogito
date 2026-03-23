import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MainLayout } from '../components/layout/MainLayout';
import { Search, UserPlus, MessageSquare, Loader2, Users } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Avatar } from '../components/ui/avatar';
import { Modal } from '../components/ui/modal';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { CreateGroupModal } from '../components/chat/CreateGroupModal';
import { findOrCreateDmChatId } from '../lib/dm';
import { cn } from '../lib/utils';
import { resolvePeerPresence, presenceShowsActivityDot, presenceDotClass } from '../lib/presenceDisplay';
import { subscribePeerPresenceBroadcast } from '../lib/presenceBroadcastBridge';
import {
  FRIEND_DM_READ_EVENT,
  chatIdToFriendIdMap,
  fetchFriendDmUnreadRows,
  formatFriendUnreadBadge,
} from '../lib/friendDmUnread';

export function Friends() {
  const { user } = useAuth();
  const [isAddFriendOpen, setIsAddFriendOpen] = useState(false);
  const [friendUsername, setFriendUsername] = useState('');
  const [loadingAdd, setLoadingAdd] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  
  const [friends, setFriends] = useState<any[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  
  const navigate = useNavigate();
  const chatIdToFriendRef = useRef<Map<string, string>>(new Map());
  const unreadResyncTimerRef = useRef<number | null>(null);

  const resyncFriendUnread = useCallback(async () => {
    if (!user?.id) return;
    const rows = await fetchFriendDmUnreadRows(supabase);
    chatIdToFriendRef.current = chatIdToFriendIdMap(rows);
    const counts = new Map(rows.map((r) => [r.friend_id, r.unread_count]));
    setFriends((prev) => prev.map((f) => ({ ...f, unreadCount: counts.get(f.id) ?? 0 })));
  }, [user?.id]);

  const loadFriends = useCallback(
    async (silent?: boolean) => {
      if (!user) return;
      if (!silent) setLoadingFriends(true);

      const { data, error } = await supabase
        .from('friends')
        .select('*, user1:users!friends_user_id_fkey(*), user2:users!friends_friend_id_fkey(*)')
        .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

      if (!error && data) {
        const mappedFriends = data.map((f: any) => {
          const friendProfile = f.user_id === user.id ? f.user2 : f.user1;
          return {
            id: friendProfile.id,
            name: friendProfile.display_name,
            username: friendProfile.username,
            avatarUrl: friendProfile.avatar_url,
            presence_status: friendProfile.presence_status ?? null,
            presence_updated_at: friendProfile.presence_updated_at ?? null,
          };
        });
        const uniqueFriends = Array.from(new Map(mappedFriends.map((item: any) => [item.id, item])).values()) as any[];
        const unreadRows = await fetchFriendDmUnreadRows(supabase);
        chatIdToFriendRef.current = chatIdToFriendIdMap(unreadRows);
        const counts = new Map(unreadRows.map((r) => [r.friend_id, r.unread_count]));
        setFriends(uniqueFriends.map((f: any) => ({ ...f, unreadCount: counts.get(f.id) ?? 0 })));
      }
      if (!silent) setLoadingFriends(false);
    },
    [user],
  );

  useEffect(() => {
    if (user) {
      void loadFriends();
    }
  }, [user, loadFriends]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && user) void loadFriends(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [user, loadFriends]);

  useEffect(() => {
    const onDmRead = (e: Event) => {
      const d = (e as CustomEvent<{ friendId?: string }>).detail;
      if (!d?.friendId) return;
      setFriends((prev) =>
        prev.map((f) => (String(f.id) === String(d.friendId) ? { ...f, unreadCount: 0 } : f)),
      );
    };
    window.addEventListener(FRIEND_DM_READ_EVENT, onDmRead);
    return () => window.removeEventListener(FRIEND_DM_READ_EVENT, onDmRead);
  }, []);

  useEffect(() => {
    return subscribePeerPresenceBroadcast((p) => {
      setFriends((prev) =>
        prev.map((f) =>
          String(f.id) === String(p.userId)
            ? {
                ...f,
                presence_status: p.presence_status,
                presence_updated_at: p.presence_updated_at,
              }
            : f,
        ),
      );
    });
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel(`friends:presence:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users' },
        (payload) => {
          const row = payload.new as {
            id?: string;
            presence_status?: string | null;
            presence_updated_at?: string | null;
          } | null;
          if (!row?.id) return;
          setFriends((prev) =>
            prev.map((f) =>
              String(f.id) === String(row.id)
                ? {
                    ...f,
                    presence_status: row.presence_status ?? null,
                    presence_updated_at: row.presence_updated_at ?? null,
                  }
                : f,
            ),
          );
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as { chat_id?: string; sender_id?: string } | null;
          if (!row?.chat_id || !row.sender_id || String(row.sender_id) === String(user.id)) return;
          const friendId = chatIdToFriendRef.current.get(String(row.chat_id));
          if (!friendId) {
            if (unreadResyncTimerRef.current != null) window.clearTimeout(unreadResyncTimerRef.current);
            unreadResyncTimerRef.current = window.setTimeout(() => {
              unreadResyncTimerRef.current = null;
              void resyncFriendUnread();
            }, 200);
            return;
          }
          setFriends((prev) =>
            prev.map((f) =>
              String(f.id) === String(friendId)
                ? { ...f, unreadCount: Math.min(100, (f.unreadCount ?? 0) + 1) }
                : f,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      if (unreadResyncTimerRef.current != null) window.clearTimeout(unreadResyncTimerRef.current);
      unreadResyncTimerRef.current = null;
      void supabase.removeChannel(ch);
    };
  }, [user?.id, resyncFriendUnread]);

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !friendUsername) return;
    setLoadingAdd(true);
    setAddError(null);
    setAddSuccess(null);

    const safeUsername = friendUsername.toLowerCase().replace(/\s/g, '');

    try {
      // Find user
      const { data: targetUser, error: findError } = await supabase
        .from('users')
        .select('id')
        .eq('username', safeUsername)
        .maybeSingle();

      if (findError || !targetUser) {
        throw new Error('User not found.');
      }

      if (targetUser.id === user.id) {
        throw new Error('You cannot add yourself.');
      }

      // Check if request already exists
      const { data: existingReq } = await supabase
        .from('friend_requests')
        .select('*')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${targetUser.id}),and(sender_id.eq.${targetUser.id},receiver_id.eq.${user.id})`)
        .maybeSingle();

      if (existingReq) {
        throw new Error('A friend request already exists between you.');
      }

      // Send request
      const { error: reqError } = await supabase
        .from('friend_requests')
        .insert({
          sender_id: user.id,
          receiver_id: targetUser.id,
        });

      if (reqError) throw reqError;

      setAddSuccess(`Friend request sent to @${safeUsername}!`);
      setFriendUsername('');
    } catch (err: any) {
      setAddError(err.message);
    } finally {
      setLoadingAdd(false);
    }
  };

  const startChat = async (friendId: string) => {
    if (!user) return;
    const result = await findOrCreateDmChatId(supabase, user.id, friendId);
    if ('chatId' in result) navigate(`/?id=${result.chatId}`);
    else console.error(result.error);
  };

  return (
    <MainLayout>
      <div className="flex flex-col min-h-full max-w-4xl mx-auto p-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:p-8 md:pb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Friends</h1>
            <p className="text-muted-foreground mt-2">Manage your connections and find new people.</p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateGroupOpen(true)}
              className="gap-2 border-border/50 bg-secondary/20 hover:bg-secondary/40"
            >
              <Users size={18} />
              <span>Create group</span>
            </Button>
            <Button onClick={() => { setIsAddFriendOpen(true); setAddError(null); setAddSuccess(null); }} className="gap-2 shadow-lg shadow-primary/20">
              <UserPlus size={18} />
              <span>Add Friend</span>
            </Button>
          </div>
        </div>

        <div className="mb-6 relative">
          <Search className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
          <Input placeholder="Search friends..." className="pl-12 box-border h-12 bg-secondary/30 border-border/50 text-base rounded-xl focus-visible:ring-primary/50" />
        </div>

        {loadingFriends ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="animate-spin text-primary" size={32} />
          </div>
        ) : friends.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-border/30 rounded-2xl bg-secondary/10">
            <UserPlus size={48} className="mx-auto mb-4 text-muted-foreground/50" />
            <p>You haven't added any friends yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {friends.map((friend, idx) => (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.05 }}
                key={friend.id} 
                className="flex items-center gap-4 p-4 rounded-2xl border border-border/40 bg-secondary/10 hover:bg-secondary/40 transition-all group shadow-sm hover:shadow-md cursor-pointer"
              >
                <div className="relative">
                  <Avatar fallback={friend.name} src={friend.avatarUrl} size="lg" className="border border-border/50" />
                  {(() => {
                    const peerP = resolvePeerPresence(friend.presence_status, friend.presence_updated_at);
                    return presenceShowsActivityDot(peerP) ? (
                      <span
                        className={cn(
                          'absolute bottom-0 right-0 z-[1] w-3 h-3 border-2 border-background rounded-full',
                          presenceDotClass(peerP),
                        )}
                      />
                    ) : null;
                  })()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="font-semibold text-foreground truncate flex-1 min-w-0">{friend.name}</h3>
                    {(friend.unreadCount ?? 0) > 0 ? (
                      <span
                        className="shrink-0 min-w-[1.35rem] h-[1.35rem] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-none inline-flex items-center justify-center shadow-sm"
                        aria-label={`${friend.unreadCount} unread messages`}
                      >
                        {formatFriendUnreadBadge(friend.unreadCount ?? 0)}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-primary/80 font-medium truncate">@{friend.username}</p>
                </div>
                <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => startChat(friend.id)} 
                    className="p-2.5 bg-primary/10 text-primary rounded-xl hover:bg-primary hover:text-white transition-colors"
                    title="Message"
                  >
                    <MessageSquare size={18} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <CreateGroupModal
        isOpen={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        friends={friends.map((f) => ({
          id: f.id,
          name: f.name,
          username: f.username,
          avatarUrl: f.avatarUrl,
        }))}
        onCreated={(id) => navigate(`/?id=${id}`)}
      />

      <Modal
        isOpen={isAddFriendOpen}
        onClose={() => setIsAddFriendOpen(false)}
        title="Add friend"
        description="Send a request using their exact username."
      >
        <form className="space-y-6" onSubmit={handleAddFriend}>
          {addError && <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-md border border-red-500/20">{addError}</div>}
          {addSuccess && <div className="p-3 text-sm text-green-500 bg-green-500/10 rounded-md border border-green-500/20">{addSuccess}</div>}
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground ml-1">Friend's Username</label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
              <Input 
                placeholder="Enter exact username" 
                className="pl-10 h-11 bg-secondary/30" 
                value={friendUsername}
                onChange={(e) => setFriendUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
                required
              />
            </div>
            <p className="text-xs text-muted-foreground ml-1">Usernames are unique and do not contain capital letters.</p>
          </div>
          <Button type="submit" disabled={loadingAdd} className="w-full h-11 text-base shadow-lg shadow-primary/20">
            {loadingAdd ? <Loader2 className="animate-spin" size={18} /> : 'Send Friend Request'}
          </Button>
        </form>
      </Modal>
    </MainLayout>
  );
}
