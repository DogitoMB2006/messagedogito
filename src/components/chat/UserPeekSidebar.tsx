import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Calendar, Loader2, MessageSquare, UserPlus, Check, UserCheck } from 'lucide-react';
import { Avatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { supabase } from '../../lib/supabase';
import { findOrCreateDmChatId } from '../../lib/dm';
import { useAuth } from '../../contexts/AuthContext';

interface UserPeekSidebarProps {
  userId: string;
  onClose: () => void;
}

type RelState = {
  isFriend: boolean;
  outgoingPending: boolean;
  incomingPending: boolean;
  incomingRequestId: string | null;
};

export function UserPeekSidebar({ userId, onClose }: UserPeekSidebarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rel, setRel] = useState<RelState>({
    isFriend: false,
    outgoingPending: false,
    incomingPending: false,
    incomingRequestId: null,
  });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [msgLoading, setMsgLoading] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(false);

  const loadProfile = useCallback(async () => {
    const { data } = await supabase.from('users').select('*').eq('id', userId).single();
    setProfile(data ?? null);
  }, [userId]);

  const loadRelationship = useCallback(async () => {
    if (!user || userId === user.id) {
      setRel({
        isFriend: false,
        outgoingPending: false,
        incomingPending: false,
        incomingRequestId: null,
      });
      return;
    }

    const id1 = user.id < userId ? user.id : userId;
    const id2 = user.id < userId ? userId : user.id;
    const { data: fr } = await supabase
      .from('friends')
      .select('user_id')
      .eq('user_id', id1)
      .eq('friend_id', id2)
      .maybeSingle();

    if (fr) {
      setRel({
        isFriend: true,
        outgoingPending: false,
        incomingPending: false,
        incomingRequestId: null,
      });
      return;
    }

    const { data: reqs } = await supabase
      .from('friend_requests')
      .select('id, sender_id, receiver_id, status')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${user.id})`)
      .eq('status', 'pending');

    const list = reqs ?? [];
    const outgoing = list.some((r) => r.sender_id === user.id && r.receiver_id === userId);
    const incomingRow = list.find((r) => r.sender_id === userId && r.receiver_id === user.id);

    setRel({
      isFriend: false,
      outgoingPending: outgoing,
      incomingPending: Boolean(incomingRow),
      incomingRequestId: incomingRow?.id ?? null,
    });
  }, [user, userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setAddError(null);
      await loadProfile();
      await loadRelationship();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile, loadRelationship]);

  useEffect(() => {
    if (!user || userId === user.id) return;

    const channel = supabase
      .channel(`user-peek-rel:${user.id}:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friends' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { user_id?: string; friend_id?: string } | undefined;
          if (!row?.user_id || !row?.friend_id) return;
          const involves =
            (row.user_id === user.id && row.friend_id === userId) ||
            (row.user_id === userId && row.friend_id === user.id);
          if (involves) void loadRelationship();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests' },
        (payload) => {
          const row = (payload.new ?? payload.old) as
            | { sender_id?: string; receiver_id?: string; status?: string }
            | undefined;
          if (!row?.sender_id || !row?.receiver_id) return;
          const pair =
            (row.sender_id === user.id && row.receiver_id === userId) ||
            (row.sender_id === userId && row.receiver_id === user.id);
          if (pair) void loadRelationship();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, userId, loadRelationship]);

  const handleAddFriend = async () => {
    if (!user || userId === user.id) return;
    setAddLoading(true);
    setAddError(null);
    try {
      const { data: existingReq } = await supabase
        .from('friend_requests')
        .select('id')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${user.id})`)
        .maybeSingle();

      if (existingReq) {
        setAddError('A friend request already exists between you.');
        return;
      }

      const { error: reqError } = await supabase.from('friend_requests').insert({
        sender_id: user.id,
        receiver_id: userId,
      });

      if (reqError) throw reqError;
      await loadRelationship();
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Could not send request');
    } finally {
      setAddLoading(false);
    }
  };

  const handleAcceptIncoming = async () => {
    if (!user || !rel.incomingRequestId) return;
    setAcceptLoading(true);
    setAddError(null);
    try {
      const { data: row } = await supabase
        .from('friend_requests')
        .select('sender_id')
        .eq('id', rel.incomingRequestId)
        .maybeSingle();
      const senderId = row?.sender_id;
      if (!senderId) throw new Error('Request not found');

      const { error: updErr } = await supabase
        .from('friend_requests')
        .update({ status: 'accepted' })
        .eq('id', rel.incomingRequestId);
      if (updErr) throw updErr;

      const id1 = user.id < senderId ? user.id : senderId;
      const id2 = user.id < senderId ? senderId : user.id;
      await supabase.from('friends').insert([{ user_id: id1, friend_id: id2 }]);

      await loadRelationship();
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Could not accept');
    } finally {
      setAcceptLoading(false);
    }
  };

  const handleMessage = async () => {
    if (!user) return;
    setMsgLoading(true);
    try {
      const result = await findOrCreateDmChatId(supabase, user.id, userId);
      if ('error' in result) {
        setAddError(result.error);
        return;
      }
      navigate(`/?id=${result.chatId}`);
      onClose();
    } finally {
      setMsgLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-background/95 backdrop-blur-md justify-center items-center shadow-[-10px_0_30px_rgba(0,0,0,0.1)] text-primary">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (!profile) return null;

  const isSelf = user?.id === userId;

  return (
    <div className="flex flex-col h-full bg-background/95 backdrop-blur-md overflow-y-auto custom-scrollbar shadow-[-10px_0_30px_rgba(0,0,0,0.1)]">
      <div className="flex items-center justify-between p-4 bg-background/40 backdrop-blur-md sticky top-0 z-20 border-b border-border/30">
        <h2 className="font-semibold text-foreground tracking-tight">Profile</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-secondary text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X size={18} />
        </button>
      </div>

      <div className="relative">
        <div className="h-28 w-full bg-secondary/80 overflow-hidden relative group">
          {profile.banner_url ? (
            <img src={profile.banner_url} alt="" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
          ) : (
            <div className="w-full h-full bg-gradient-to-tr from-primary/20 to-accent/20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
        </div>

        <div className="px-5 absolute -bottom-10 left-0">
          <Avatar
            size="xl"
            fallback={profile.display_name}
            src={profile.avatar_url}
            className="border-4 border-background shadow-xl ring-1 ring-border/50 bg-secondary"
          />
        </div>
      </div>

      <div className="px-5 pt-14 pb-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">{profile.display_name}</h1>
          <p className="text-sm text-primary font-medium">@{profile.username}</p>
        </div>

        <div className="p-3 rounded-xl bg-secondary/20 border border-border/30">
          <p className="text-sm text-foreground/90 leading-relaxed">{profile.bio || 'No bio yet.'}</p>
        </div>

        <div className="flex items-center gap-3 text-sm text-muted-foreground px-1">
          <Calendar size={16} className="text-primary/70 shrink-0" />
          <span>Joined {new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        </div>

        {addError && (
          <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-md border border-red-500/20">{addError}</div>
        )}

        {!isSelf && user && (
          <div className="space-y-3 pt-2">
            {rel.isFriend ? (
              <Button
                type="button"
                className="w-full gap-2 shadow-md shadow-primary/15"
                onClick={() => void handleMessage()}
                disabled={msgLoading}
              >
                {msgLoading ? <Loader2 className="animate-spin" size={18} /> : <MessageSquare size={18} />}
                Message
              </Button>
            ) : rel.incomingPending ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground text-center">This user sent you a friend request</p>
                <Button
                  type="button"
                  className="w-full gap-2"
                  onClick={() => void handleAcceptIncoming()}
                  disabled={acceptLoading}
                >
                  {acceptLoading ? <Loader2 className="animate-spin" size={18} /> : <UserCheck size={18} />}
                  Accept friend request
                </Button>
              </div>
            ) : rel.outgoingPending ? (
              <div className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-secondary/30 border border-border/40 text-sm text-muted-foreground">
                <Check size={16} className="text-primary shrink-0" />
                Friend request sent
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 border-border/50 bg-secondary/30 hover:bg-secondary/50"
                onClick={() => void handleAddFriend()}
                disabled={addLoading}
              >
                {addLoading ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
                Add friend
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
