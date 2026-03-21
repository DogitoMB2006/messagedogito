import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Loader2, LogOut } from 'lucide-react';
import { Input } from '../ui/input';
import { Avatar } from '../ui/avatar';
import { cn } from '../../lib/utils';
import { motion } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { formatChatMessageHtml } from '../../lib/chatRichText';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { LeaveGroupModal } from './LeaveGroupModal';
import { CHAT_LIST_INVALIDATE_EVENT } from '../../lib/chatListInvalidate';
import { getSidebarPreviewText } from '../../lib/replyMessageFormat';
import { resolvePeerPresence, presenceShowsActivityDot, presenceDotClass } from '../../lib/presenceDisplay';
import { subscribePeerPresenceBroadcast } from '../../lib/presenceBroadcastBridge';
import { PresenceStatusControl } from './PresenceStatusControl';
import {
  CHAT_READ_EVENT,
  FRIEND_DM_READ_EVENT,
  fetchUnreadCountByChatId,
  formatFriendUnreadBadge,
} from '../../lib/friendDmUnread';
import {
  type ChatTypingRow,
  CHAT_TYPING_BRIDGE_EVENT,
  type ChatTypingBridgeDetail,
  formatTypingLabel,
  isTypingRowFresh,
  typingDisplayNames,
} from '../../lib/chatTyping';
import { TypingDots } from './TypingDots';

interface ChatListProps {
  activeChat: string | null;
  onSelectChat: (id: string) => void;
  /** Clear home URL when user leaves this chat (same id as active). */
  onClearActiveIfMatch?: (chatId: string) => void;
}

export function ChatList({ activeChat, onSelectChat, onClearActiveIfMatch }: ChatListProps) {
  const { user } = useAuth();
  const activeChatRef = useRef<string | null>(activeChat);
  activeChatRef.current = activeChat;
  const [chats, setChats] = useState<any[]>([]);
  const [typingByChat, setTypingByChat] = useState<Record<string, Record<string, ChatTypingRow>>>({});
  const [loading, setLoading] = useState(true);
  const [ctxMenu, setCtxMenu] = useState<{ chat: any; left: number; top: number } | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<{ id: string; name: string; isOwner: boolean } | null>(null);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const chatListInvalidateTimerRef = useRef<number | null>(null);
  const navigate = useNavigate();
  const toEmojiHtml = (text: string) =>
    formatChatMessageHtml(text, { multilineBreaks: false, emoji: true });

  const chatIdsKey = useMemo(() => chats.map((c) => c.id).sort().join(','), [chats]);

  useEffect(() => {
    const t = window.setInterval(() => {
      setTypingByChat((prev) => {
        let changed = false;
        const out: Record<string, Record<string, ChatTypingRow>> = {};
        for (const [cid, peers] of Object.entries(prev)) {
          const inner: Record<string, ChatTypingRow> = {};
          for (const [uid, row] of Object.entries(peers)) {
            if (isTypingRowFresh(row)) inner[uid] = row;
            else changed = true;
          }
          if (Object.keys(inner).length) out[cid] = inner;
          else if (Object.keys(peers).length) changed = true;
        }
        return changed ? out : prev;
      });
    }, 1100);
    return () => window.clearInterval(t);
  }, []);

  const loadChats = useCallback(async () => {
    const uid = user?.id;
    if (!uid) return;

    const { data: myParticipants } = await supabase
      .from('chat_participants')
      .select('chat_id, chats(*)')
      .eq('user_id', uid);

    if (!myParticipants || myParticipants.length === 0) {
      setChats([]);
      setLoading(false);
      return;
    }

    const chatIds = [...new Set(myParticipants.map((p) => p.chat_id))];

    const { data: otherParticipants } = await supabase
      .from('chat_participants')
      .select('chat_id, user_id, users:users(*)')
      .in('chat_id', chatIds)
      .neq('user_id', uid);

    const othersByChat = new Map<string, typeof otherParticipants>();
    for (const row of otherParticipants || []) {
      const list = othersByChat.get(row.chat_id) || [];
      list.push(row);
      othersByChat.set(row.chat_id, list);
    }

    // One latest row per chat (global .in() + .order() is capped by row limits and can hide quiet threads).
    const lastRows = await Promise.all(
      chatIds.map((cid) =>
        supabase
          .from('messages')
          .select('content, created_at')
          .eq('chat_id', cid)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    );
    const lastByChat = new Map<string, { content: string; created_at: string }>();
    chatIds.forEach((cid, i) => {
      const row = lastRows[i]?.data;
      if (row) lastByChat.set(cid, row as { content: string; created_at: string });
    });

    const unreadByChatId = await fetchUnreadCountByChatId(supabase);

    const mapped = myParticipants.map((p) => {
      const chat = Array.isArray(p.chats) ? p.chats[0] : p.chats;
      const isGroup = Boolean(chat?.is_group);
      const lastMessage = lastByChat.get(p.chat_id) ?? null;

      let name = 'Chat';
      let avatar: string | undefined;
      let otherUserId: string | undefined;
      let peerPresenceStatus: string | null = null;
      let peerPresenceUpdatedAt: string | null = null;

      if (isGroup) {
        name = (chat?.name as string) || 'Group';
        avatar = (chat?.avatar_url as string) || undefined;
      } else {
        const others = othersByChat.get(p.chat_id) || [];
        const row = others[0];
        const otherUser = row?.users ? (Array.isArray(row.users) ? row.users[0] : row.users) : null;
        name = otherUser?.display_name || 'Unknown User';
        avatar = otherUser?.avatar_url;
        otherUserId = otherUser?.id;
        const ou = otherUser as { presence_status?: string; presence_updated_at?: string } | null;
        peerPresenceStatus = ou?.presence_status ?? null;
        peerPresenceUpdatedAt = ou?.presence_updated_at ?? null;
      }

      const unread = unreadByChatId.get(p.chat_id) ?? 0;

      return {
        id: p.chat_id,
        name,
        avatar,
        lastMessage: lastMessage ? getSidebarPreviewText(lastMessage.content) : 'Started a chat',
        time: lastMessage ? new Date(lastMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        unread,
        peerPresenceStatus,
        peerPresenceUpdatedAt,
        lastMsgTimeRaw: lastMessage ? new Date(lastMessage.created_at).getTime() : 0,
        otherUserId,
        isGroup,
        isGroupOwner: Boolean(chat?.owner_id && uid === chat.owner_id),
      };
    });

    const dedup = Array.from(new Map(mapped.map((c) => [c.id, c])).values());
    dedup.sort((a, b) => b.lastMsgTimeRaw - a.lastMsgTimeRaw);
    setChats(dedup);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    const onDmRead = (e: Event) => {
      const d = (e as CustomEvent<{ friendId?: string }>).detail;
      if (!d?.friendId) return;
      setChats((prev) =>
        prev.map((c) =>
          c.otherUserId != null && String(c.otherUserId) === String(d.friendId) ? { ...c, unread: 0 } : c,
        ),
      );
    };
    window.addEventListener(FRIEND_DM_READ_EVENT, onDmRead);
    return () => window.removeEventListener(FRIEND_DM_READ_EVENT, onDmRead);
  }, []);

  useEffect(() => {
    const onTypingBridge = (e: Event) => {
      const d = (e as CustomEvent<ChatTypingBridgeDetail>).detail;
      if (!d) return;
      if (d.kind === 'ping') {
        setTypingByChat((prev) => ({
          ...prev,
          [d.chatId]: { ...(prev[d.chatId] || {}), [d.row.user_id]: d.row },
        }));
        return;
      }
      const uid = d.userId;
      const cid = d.chatId;
      setTypingByChat((prev) => {
        const inner = prev[cid];
        if (!inner?.[uid]) return prev;
        const nextInner = { ...inner };
        delete nextInner[uid];
        const next = { ...prev };
        if (Object.keys(nextInner).length) next[cid] = nextInner;
        else delete next[cid];
        return next;
      });
    };
    window.addEventListener(CHAT_TYPING_BRIDGE_EVENT, onTypingBridge);
    return () => window.removeEventListener(CHAT_TYPING_BRIDGE_EVENT, onTypingBridge);
  }, []);

  useEffect(() => {
    const onChatRead = (e: Event) => {
      const d = (e as CustomEvent<{ chatId?: string }>).detail;
      if (!d?.chatId) return;
      setChats((prev) =>
        prev.map((c) => (String(c.id) === String(d.chatId) ? { ...c, unread: 0 } : c)),
      );
    };
    window.addEventListener(CHAT_READ_EVENT, onChatRead);
    return () => window.removeEventListener(CHAT_READ_EVENT, onChatRead);
  }, []);

  useEffect(() => {
    return subscribePeerPresenceBroadcast((p) => {
      setChats((prev) =>
        prev.map((c) =>
          c.otherUserId != null && String(c.otherUserId) === String(p.userId)
            ? {
                ...c,
                peerPresenceStatus: p.presence_status,
                peerPresenceUpdatedAt: p.presence_updated_at,
              }
            : c,
        ),
      );
    });
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    void loadChats();

    const channel = supabase
      .channel('public:messages:all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, () => {
        void loadChats();
      })
      // Scoped to this user so new group invites (INSERT) and leaves (DELETE) always trigger a reload.
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_participants',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void loadChats();
        },
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, (payload) => {
        const row = payload.new as {
          id?: string;
          presence_status?: string | null;
          presence_updated_at?: string | null;
        } | null;
        if (!row?.id) return;
        setChats((prev) =>
          prev.map((c) =>
            c.otherUserId === row.id
              ? {
                  ...c,
                  peerPresenceStatus: row.presence_status ?? null,
                  peerPresenceUpdatedAt: row.presence_updated_at ?? null,
                }
              : c,
          ),
        );
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as { chat_id?: string; sender_id?: string } | null;
          if (!row?.chat_id || !row.sender_id || String(row.sender_id) === String(user.id)) return;
          setChats((prev) =>
            prev.map((c) => {
              if (String(c.id) !== String(row.chat_id)) return c;
              if (String(activeChatRef.current) === String(c.id)) return c;
              return { ...c, unread: Math.min(100, (c.unread ?? 0) + 1) };
            }),
          );
        },
      )
      .subscribe();

    const inbox = supabase
      .channel(`user-chat-inbox:${user.id}`, {
        config: { broadcast: { self: true } },
      })
      .on('broadcast', { event: 'refresh_chats' }, () => {
        void loadChats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(inbox);
    };
  }, [user?.id, loadChats]);

  useEffect(() => {
    if (!user?.id || loading) return;
    const ids = chatIdsKey ? chatIdsKey.split(',').filter(Boolean) : [];
    if (ids.length === 0) {
      setTypingByChat({});
      return;
    }

    let cancelled = false;
    const filter = `chat_id=in.(${ids.join(',')})`;

    void (async () => {
      const { data } = await supabase.from('chat_typing').select('*').in('chat_id', ids);
      if (cancelled || !data) return;
      const next: Record<string, Record<string, ChatTypingRow>> = {};
      for (const row of data as ChatTypingRow[]) {
        if (String(row.user_id) === String(user.id)) continue;
        if (!isTypingRowFresh(row)) continue;
        const cid = String(row.chat_id);
        if (!next[cid]) next[cid] = {};
        next[cid][String(row.user_id)] = row;
      }
      setTypingByChat(next);
    })();

    const channel = supabase
      .channel(`public:chat_typing:list:${user.id}:${chatIdsKey}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_typing', filter },
        (payload) => {
          const row = payload.new as ChatTypingRow | null;
          if (!row?.chat_id || String(row.user_id) === String(user.id)) return;
          const cid = String(row.chat_id);
          setTypingByChat((prev) => ({
            ...prev,
            [cid]: { ...(prev[cid] || {}), [String(row.user_id)]: row },
          }));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_typing', filter },
        (payload) => {
          const row = payload.new as ChatTypingRow | null;
          if (!row?.chat_id || String(row.user_id) === String(user.id)) return;
          const cid = String(row.chat_id);
          setTypingByChat((prev) => ({
            ...prev,
            [cid]: { ...(prev[cid] || {}), [String(row.user_id)]: row },
          }));
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'chat_typing', filter },
        (payload) => {
          const row = payload.old as { chat_id?: string; user_id?: string } | null;
          if (!row?.chat_id || !row.user_id) return;
          const cid = String(row.chat_id);
          const uid = String(row.user_id);
          setTypingByChat((prev) => {
            const inner = prev[cid];
            if (!inner?.[uid]) return prev;
            const nextInner = { ...inner };
            delete nextInner[uid];
            const next = { ...prev };
            if (Object.keys(nextInner).length) next[cid] = nextInner;
            else delete next[cid];
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id, loading, chatIdsKey]);

  useEffect(() => {
    const schedule = () => {
      if (chatListInvalidateTimerRef.current != null) {
        window.clearTimeout(chatListInvalidateTimerRef.current);
      }
      chatListInvalidateTimerRef.current = window.setTimeout(() => {
        chatListInvalidateTimerRef.current = null;
        void loadChats();
      }, 80);
    };
    window.addEventListener(CHAT_LIST_INVALIDATE_EVENT, schedule);
    return () => {
      window.removeEventListener(CHAT_LIST_INVALIDATE_EVENT, schedule);
      if (chatListInvalidateTimerRef.current != null) {
        window.clearTimeout(chatListInvalidateTimerRef.current);
        chatListInvalidateTimerRef.current = null;
      }
    };
  }, [loadChats]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      const el = ctxMenuRef.current;
      if (el && !el.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  const confirmLeaveFromList = async () => {
    if (!leaveTarget) return;
    const leftId = leaveTarget.id;
    setLeaveLoading(true);
    try {
      const { error } = await supabase.rpc('leave_group', { p_chat_id: leftId });
      if (error) throw error;
      setLeaveTarget(null);
      onClearActiveIfMatch?.(leftId);
      await loadChats();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not leave the group.';
      alert(`${msg} Run supabase/group_leave.sql if needed.`);
    } finally {
      setLeaveLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background/50 backdrop-blur-sm">
      {/* Header */}
      <div className="p-4 flex items-center justify-between gap-2 border-b border-border/30">
        <h1 className="text-2xl font-bold tracking-tight text-foreground shrink-0">Messages</h1>
        <div className="flex items-center gap-1.5 shrink-0">
          <PresenceStatusControl />
          <button
            type="button"
            title="Friends"
            onClick={() => navigate('/friends')}
            className="h-9 w-9 flex items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search messages or friends" className="pl-9 h-10 border-none bg-secondary/50 focus-visible:bg-secondary/80 focus-visible:ring-1 focus-visible:ring-primary/50 rounded-xl" />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1 custom-scrollbar">
        {loading ? (
          <div className="flex justify-center p-4"><Loader2 className="animate-spin text-muted-foreground" size={24} /></div>
        ) : chats.length === 0 ? (
          <div className="text-center p-4 text-muted-foreground text-sm">No chats yet.<br/>Go to Friends to start one!</div>
        ) : (
          chats.map((chat) => (
            <motion.div
              key={chat.id}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => {
                if ((chat.unread ?? 0) > 0) {
                  setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, unread: 0 } : c)));
                }
                onSelectChat(chat.id);
              }}
              onContextMenu={(e) => {
                if (!chat.isGroup) return;
                e.preventDefault();
                const pad = 12;
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const menuW = Math.min(240, vw - 24);
                const menuH = 52;
                const cx = e.clientX;
                const cy = e.clientY;
                let left = cx - menuW / 2;
                let top = cy + 8;
                left = Math.max(pad, Math.min(left, vw - menuW - pad));
                top = Math.max(pad, Math.min(top, vh - menuH - pad));
                setCtxMenu({ chat, left, top });
              }}
              className={cn(
                "relative flex flex-row items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors duration-200 group",
                activeChat === chat.id 
                  ? "bg-primary/10 before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-1 before:h-8 before:bg-primary before:rounded-r-full" 
                  : "hover:bg-secondary/40"
              )}
            >
              <div className="relative shrink-0">
                <Avatar fallback={chat.name} src={chat.avatar} />
                {(() => {
                  const peerP = resolvePeerPresence(chat.peerPresenceStatus, chat.peerPresenceUpdatedAt);
                  return !chat.isGroup && presenceShowsActivityDot(peerP) ? (
                    <span
                      className={cn(
                        'absolute bottom-0 right-0 w-3 h-3 border-2 border-background rounded-full',
                        presenceDotClass(peerP),
                      )}
                    />
                  ) : null;
                })()}
              </div>
              
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="flex justify-between items-baseline mb-1 gap-2 min-w-0">
                  <span className="font-semibold text-sm truncate text-foreground flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{chat.name}</span>
                    {(chat.unread ?? 0) > 0 ? (
                      <span
                        className="shrink-0 min-w-[1.2rem] h-[1.15rem] px-1 rounded-full bg-red-600 text-white text-[9px] font-bold leading-none inline-flex items-center justify-center"
                        aria-label={`${chat.unread} unread`}
                      >
                        {formatFriendUnreadBadge(chat.unread ?? 0)}
                      </span>
                    ) : null}
                  </span>
                  <span className={cn("text-xs whitespace-nowrap ml-2", chat.unread > 0 ? "text-primary font-medium" : "text-muted-foreground")}>
                    {chat.time}
                  </span>
                </div>
                <p className={cn("text-xs truncate", chat.unread > 0 ? "text-foreground font-medium" : "text-muted-foreground")}>
                  {(() => {
                    const peers = typingByChat[String(chat.id)];
                    const typingLabel = peers
                      ? formatTypingLabel(typingDisplayNames(Object.values(peers), user?.id))
                      : '';
                    if (typingLabel) {
                      return (
                        <span className="inline-flex items-baseline gap-1 max-w-full text-primary/90">
                          <span className="truncate">{typingLabel}</span>
                          <TypingDots className="shrink-0 inline-block w-[1.15rem] tabular-nums" />
                        </span>
                      );
                    }
                    return (
                      <span
                        className="emoji-render"
                        dangerouslySetInnerHTML={{ __html: toEmojiHtml(String(chat.lastMessage ?? '')) }}
                      />
                    );
                  })()}
                </p>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-[60] w-[min(240px,calc(100vw-24px))] rounded-xl border border-border/50 bg-background/95 backdrop-blur-xl shadow-xl py-1 overflow-hidden"
          style={{ left: ctxMenu.left, top: ctxMenu.top }}
        >
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-foreground hover:bg-secondary/70 transition-colors"
            onClick={() => {
              setLeaveTarget({
                id: ctxMenu.chat.id,
                name: ctxMenu.chat.name,
                isOwner: Boolean(ctxMenu.chat.isGroupOwner),
              });
              setCtxMenu(null);
            }}
          >
            <LogOut size={16} className="text-muted-foreground shrink-0" />
            Leave group
          </button>
        </div>
      )}

      <LeaveGroupModal
        isOpen={Boolean(leaveTarget)}
        onClose={() => !leaveLoading && setLeaveTarget(null)}
        groupName={leaveTarget?.name ?? 'Group'}
        isOwner={leaveTarget?.isOwner ?? false}
        loading={leaveLoading}
        onConfirmLeave={confirmLeaveFromList}
      />
    </div>
  );
}
