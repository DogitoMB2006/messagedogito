import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clapperboard,
  CornerUpLeft,
  Info,
  Loader2,
  Paperclip,
  Phone,
  Send,
  Settings,
  Smile,
  Trash2,
  Video,
  Image as ImageIcon,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { Avatar } from '../ui/avatar';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { GifPicker } from './GifPicker';
import { GroupManageModal } from './GroupManageModal';
import { GROUP_LEAVE_MESSAGE, isGroupLeaveMessage } from '../../lib/groupMessageMarkers';
import { formatChatMessageHtml } from '../../lib/chatRichText';
import { splitLeadingReply, getQuotedMessageLabel, isChatMediaUrl } from '../../lib/replyMessageFormat';

interface ChatWindowProps {
  chatId: string;
  onToggleProfile: () => void;
  isProfileOpen: boolean;
  /** Group chats: open member profile preview (right panel on Home). */
  onPeekUser?: (userId: string) => void;
}

/** Dedupe + chronological order (postgres_changes may miss under RLS; broadcast fills the gap). */
function mergeMessageList(prev: any[], record: unknown): any[] {
  const r = record as { id?: unknown; created_at?: string } | null;
  if (!r?.id) return prev;
  const id = String(r.id);
  if (prev.some((m) => m?.id != null && String(m.id) === id)) return prev;
  return [...prev, record].sort(
    (a, b) => new Date((a as any).created_at).getTime() - new Date((b as any).created_at).getTime(),
  );
}

export function ChatWindow({ chatId, onToggleProfile, isProfileOpen, onPeekUser }: ChatWindowProps) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [gifOpen, setGifOpen] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [otherUser, setOtherUser] = useState<any>(null);
  const [chatRow, setChatRow] = useState<any>(null);
  const [isGroup, setIsGroup] = useState(false);
  const [senderNameById, setSenderNameById] = useState<Record<string, string>>({});
  const [senderAvatarById, setSenderAvatarById] = useState<Record<string, string | undefined>>({});
  const [myGroupRole, setMyGroupRole] = useState<any>(null);
  const [isGroupOwner, setIsGroupOwner] = useState(false);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [friendsForInvite, setFriendsForInvite] = useState<
    { id: string; name: string; username: string; avatarUrl: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [removedFromGroup, setRemovedFromGroup] = useState(false);
  /** Why the group-style full-screen overlay is shown (kicked / deleted / bad link). */
  const [groupExitKind, setGroupExitKind] = useState<'kicked' | 'deleted' | 'unavailable' | null>(null);

  const [editingMessageId, setEditingMessageId] = useState<string | number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [replyingToMsg, setReplyingToMsg] = useState<any | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [contextMenuMsg, setContextMenuMsg] = useState<any>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  /** After switching chats, snap scroll to bottom once the thread is shown. */
  const snapToBottomAfterOpenRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const emojiPickerWrapperRef = useRef<HTMLDivElement | null>(null);
  const messageNodeMapRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  /** True after we've successfully loaded this chat as a group (so a missing row = deleted, not a bad DM link). */
  const wasGroupChatRef = useRef(false);

  useEffect(() => {
    wasGroupChatRef.current = false;
    setRemovedFromGroup(false);
    setGroupExitKind(null);
  }, [chatId]);

  useEffect(() => {
    snapToBottomAfterOpenRef.current = true;
  }, [chatId]);

  useLayoutEffect(() => {
    if (loading || removedFromGroup) return;
    if (!snapToBottomAfterOpenRef.current) return;
    const el = messagesScrollRef.current;
    if (!el) return;

    const snap = () => {
      el.scrollTop = el.scrollHeight;
    };

    snap();
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(snap);
    });
    const t1 = window.setTimeout(snap, 64);
    const t2 = window.setTimeout(snap, 200);

    snapToBottomAfterOpenRef.current = false;

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [chatId, loading, messages.length, removedFromGroup]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = messagesScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
  }, []);

  const toEmojiHtml = (text: string) =>
    formatChatMessageHtml(text, { multilineBreaks: true, emoji: true });

  const scrollToMessageById = (targetId: string) => {
    const el = messageNodeMapRef.current.get(String(targetId));
    if (!el) return;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(String(targetId));

    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimeoutRef.current = null;
    }, 1500);
  };

  const renderMessageContent = (content: string) => {
    const replyPrefixMatch = content.match(/^↪(?:\[id:([^\]]+)\]\s)?(.+?)\n([\s\S]*)$/);
    if (replyPrefixMatch) {
      const [, replyMessageId, replyMeta, body] = replyPrefixMatch;
      return (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              if (!replyMessageId) return;
              scrollToMessageById(replyMessageId);
            }}
            className={`border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground text-left ${
              replyMessageId ? 'hover:text-foreground hover:border-primary/70 transition-colors cursor-pointer' : ''
            }`}
            disabled={!replyMessageId}
            dangerouslySetInnerHTML={{ __html: toEmojiHtml(replyMeta) }}
          >
          </button>
          {isChatMediaUrl(body) ? (
            <img
              src={body}
              alt="Media message"
              className="w-full max-w-[520px] max-h-[340px] object-contain rounded-2xl"
              draggable={false}
            />
          ) : (
            <div
              className="text-sm leading-relaxed whitespace-pre-wrap break-words emoji-render"
              dangerouslySetInnerHTML={{ __html: toEmojiHtml(body) }}
            />
          )}
        </div>
      );
    }

    if (isChatMediaUrl(content)) {
      return (
        <img
          src={content}
          alt="Media message"
          className="w-full max-w-[520px] max-h-[340px] object-contain rounded-2xl"
          draggable={false}
        />
      );
    }

    return <div className="text-sm leading-relaxed whitespace-pre-wrap break-words emoji-render" dangerouslySetInnerHTML={{ __html: toEmojiHtml(content) }} />;
  };

  const getMessagePreviewLabel = (content: unknown) => getQuotedMessageLabel(content);

  const insertMessage = async (content: string) => {
    if (!content.trim() || !user || removedFromGroup) return;
    if (content.trim() === GROUP_LEAVE_MESSAGE) return;

    const { data, error } = await supabase
      .from('messages')
      .insert({
        chat_id: chatId,
        sender_id: user.id,
        content: content.trim(),
      })
      .select()
      .single();

    if (error || !data) {
      console.error('insertMessage', error);
      return;
    }

    setMessages((prev) => mergeMessageList(prev, data));
    requestAnimationFrame(() => scrollToBottom('smooth'));

    const ch = realtimeChannelRef.current;
    if (ch) {
      try {
        await ch.send({
          type: 'broadcast',
          event: 'message_inserted',
          payload: { record: data },
        });
      } catch (e) {
        console.warn('Realtime broadcast send failed', e);
      }
    }
  };

  const sendMediaMessage = async (contentUrl: string) => {
    setSendingMedia(true);
    try {
      await insertMessage(contentUrl);
    } finally {
      setSendingMedia(false);
    }
  };

  const uploadAndSendImage = async (file: File) => {
    if (!user) return;
    setSendingMedia(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const fileName = `${user.id}-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
      const filePath = `messages/${fileName}`;

      const { error: uploadError } = await supabase.storage.from('chatimages').upload(filePath, file, {
        upsert: true,
      });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('chatimages').getPublicUrl(filePath);
      if (!data?.publicUrl) throw new Error('Failed to resolve public URL for uploaded image.');

      await insertMessage(data.publicUrl);
    } finally {
      setSendingMedia(false);
    }
  };

  const cancelSelectedImage = () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(null);
    setImagePreviewUrl(null);
  };

  const sendSelectedImage = async () => {
    if (!imageFile) return;
    const file = imageFile;
    cancelSelectedImage();
    await uploadAndSendImage(file);
  };

  const startEditingMessage = (msg: any) => {
    const msgId = msg?.id;
    if (!msgId) return;
    if (typeof msg?.content === 'string' && isChatMediaUrl(msg.content)) return;
    setEditingMessageId(msgId);
    setEditingValue(typeof msg?.content === 'string' ? splitLeadingReply(msg.content).body : '');
  };

  const startReplyMessage = (msg: any) => {
    setReplyingToMsg(msg);
    closeContextMenu();
  };

  const cancelEditingMessage = () => {
    setEditingMessageId(null);
    setEditingValue('');
  };

  const saveEditingMessage = async () => {
    if (!editingMessageId || !user || removedFromGroup) return;

    const next = editingValue.trim();
    if (!next) return;

    const row = messages.find((m) => m?.id != null && String(m.id) === String(editingMessageId));
    const raw = typeof row?.content === 'string' ? row.content : '';
    const { isReply, prefix } = splitLeadingReply(raw);
    const contentToStore = isReply ? prefix + next : next;

    try {
      await supabase.from('messages').update({ content: contentToStore }).eq('id', editingMessageId);
      cancelEditingMessage();
    } catch (e) {
      console.error('Failed to update message', e);
      alert('Failed to save message edit.');
    }
  };

  const canDeleteOthersMsgs = isGroupOwner || Boolean(myGroupRole?.can_delete_others_messages);
  const canKickMembers = isGroupOwner || Boolean(myGroupRole?.can_kick);

  const deleteMessage = async (msg: any) => {
    if (!user || !msg?.id || removedFromGroup) return;
    const isOwn = msg.sender_id === user.id;
    if (!isOwn && !canDeleteOthersMsgs) return;

    const confirmed = window.confirm('Delete this message?');
    if (!confirmed) return;

    const del = supabase.from('messages').delete().eq('id', msg.id);
    const { error } = isOwn ? await del.eq('sender_id', user.id) : await del;
    if (error) {
      console.error('Failed to delete message', error);
      alert('Failed to delete message.');
      return;
    }

    const mid = String(msg.id);
    setMessages((prev) => prev.filter((m) => !(m?.id != null && String(m.id) === mid)));
    if (replyingToMsg?.id && String(replyingToMsg.id) === mid) {
      setReplyingToMsg(null);
    }
    closeContextMenu();

    try {
      await realtimeChannelRef.current?.send({
        type: 'broadcast',
        event: 'message_deleted',
        payload: { id: msg.id, chat_id: chatId },
      });
    } catch (e) {
      console.warn('message_deleted broadcast failed', e);
    }
  };

  const closeContextMenu = () => {
    setContextMenuOpen(false);
    setContextMenuMsg(null);
  };

  useEffect(() => {
    if (!groupManageOpen || !user) return;
    (async () => {
      const { data } = await supabase
        .from('friends')
        .select('*, user1:users!friends_user_id_fkey(*), user2:users!friends_friend_id_fkey(*)')
        .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);
      if (!data) return;
      const mapped = data.map((f: any) => {
        const friendProfile = f.user_id === user.id ? f.user2 : f.user1;
        return {
          id: friendProfile.id,
          name: friendProfile.display_name,
          username: friendProfile.username,
          avatarUrl: friendProfile.avatar_url,
        };
      });
      setFriendsForInvite(Array.from(new Map(mapped.map((item: any) => [item.id, item])).values()) as any[]);
    })();
  }, [groupManageOpen, user]);

  useEffect(() => {
    if (!contextMenuOpen) return;

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (contextMenuRef.current && !contextMenuRef.current.contains(target)) {
        closeContextMenu();
      }
    };

    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);

    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [contextMenuOpen]);

  useEffect(() => {
    if (!emojiOpen) return;

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (emojiPickerWrapperRef.current && !emojiPickerWrapperRef.current.contains(target)) {
        setEmojiOpen(false);
      }
    };

    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEmojiOpen(false);
    };

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [emojiOpen]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const loadChat = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (!user) return;

      if (!silent) setLoading(true);

      const { data: chat } = await supabase.from('chats').select('*').eq('id', chatId).maybeSingle();

      if (!chat) {
        setChatRow(null);
        setIsGroup(false);
        setRemovedFromGroup(true);
        setGroupExitKind(wasGroupChatRef.current ? 'deleted' : 'unavailable');
        setGroupManageOpen(false);
        setMyGroupRole(null);
        setIsGroupOwner(false);
        setSenderNameById({});
        setSenderAvatarById({});
        setOtherUser(null);
        setMessages([]);
        if (!silent) setLoading(false);
        return;
      }

      setChatRow(chat);
      if (chat.is_group) {
        wasGroupChatRef.current = true;
      } else {
        wasGroupChatRef.current = false;
      }

      const group = Boolean(chat.is_group);
      setIsGroup(group);

      if (group) {
        const uid = user.id;
        const { data: myMembership } = await supabase
          .from('chat_participants')
          .select('user_id, group_role_id')
          .eq('chat_id', chatId)
          .eq('user_id', uid)
          .maybeSingle();

        if (!myMembership) {
          setRemovedFromGroup(true);
          setGroupExitKind('kicked');
          setGroupManageOpen(false);
          setMyGroupRole(null);
          setIsGroupOwner(false);
          setSenderNameById({});
          setSenderAvatarById({});
          setOtherUser(null);
          setMessages([]);
          if (!silent) setLoading(false);
          return;
        }

        setRemovedFromGroup(false);
        setGroupExitKind(null);

        const { data: allParts } = await supabase
          .from('chat_participants')
          .select('user_id, group_role_id, users(*)')
          .eq('chat_id', chatId);

        const names: Record<string, string> = {};
        const avatars: Record<string, string | undefined> = {};
        for (const row of allParts || []) {
          const u = row.users ? (Array.isArray(row.users) ? row.users[0] : row.users) : null;
          if (u?.id) {
            names[u.id] = u.display_name || u.username || 'User';
            avatars[u.id] = u.avatar_url ?? undefined;
          }
        }
        setSenderNameById(names);
        setSenderAvatarById(avatars);

        setOtherUser(null);
        setIsGroupOwner(chat?.owner_id === uid);

        if (myMembership.group_role_id) {
          const { data: role } = await supabase
            .from('group_roles')
            .select('*')
            .eq('id', myMembership.group_role_id)
            .maybeSingle();
          setMyGroupRole(role);
        } else {
          setMyGroupRole(null);
        }
      } else {
        setRemovedFromGroup(false);
        setGroupExitKind(null);
        const { data: allParts } = await supabase
          .from('chat_participants')
          .select('user_id, group_role_id, users(*)')
          .eq('chat_id', chatId);

        const otherRow = allParts?.find((r: any) => r.user_id !== user.id);
        const u = otherRow?.users ? (Array.isArray(otherRow.users) ? otherRow.users[0] : otherRow.users) : null;
        setOtherUser(u || null);
        setMyGroupRole(null);
        setIsGroupOwner(false);
        setSenderNameById({});
        setSenderAvatarById({});
      }

      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      if (msgs) {
        setMessages(msgs);
      }
      if (!silent) setLoading(false);
    },
    [chatId, user?.id],
  );

  const broadcastGroupSyncToPeers = useCallback(() => {
    try {
      void realtimeChannelRef.current?.send({
        type: 'broadcast',
        event: 'group_sync',
        payload: { chatId },
      });
    } catch (e) {
      console.warn('group_sync broadcast failed', e);
    }
  }, [chatId]);

  useEffect(() => {
    if (chatId && user?.id) {
      void loadChat();

      const channel = supabase
        .channel(`public:messages:${chatId}`, {
          config: { broadcast: { self: true } },
        })
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const row = payload.new;
            setMessages((prev) => mergeMessageList(prev, row));
            requestAnimationFrame(() => scrollToBottom('smooth'));
          },
        )
        .on('broadcast', { event: 'message_inserted' }, ({ payload }) => {
          const record = payload?.record as { id?: unknown; chat_id?: string } | undefined;
          if (!record?.id || String(record.chat_id) !== String(chatId)) return;
          setMessages((prev) => mergeMessageList(prev, record));
          requestAnimationFrame(() => scrollToBottom('smooth'));
        })
        .on('broadcast', { event: 'group_sync' }, ({ payload }) => {
          const p = payload as { chatId?: string } | undefined;
          if (String(p?.chatId) !== String(chatId)) return;
          void loadChat({ silent: true });
        })
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'chats', filter: `id=eq.${chatId}` },
          () => {
            setRemovedFromGroup(true);
            setGroupExitKind(wasGroupChatRef.current ? 'deleted' : 'unavailable');
            setGroupManageOpen(false);
            setMyGroupRole(null);
            setIsGroupOwner(false);
            setSenderNameById({});
            setSenderAvatarById({});
            setOtherUser(null);
            setChatRow(null);
            setIsGroup(false);
            setMessages([]);
          },
        )
        .on('broadcast', { event: 'message_deleted' }, ({ payload }) => {
          const p = payload as { id?: unknown; chat_id?: string } | undefined;
          if (!p?.id || String(p.chat_id) !== String(chatId)) return;
          const mid = String(p.id);
          setMessages((prev) => prev.filter((m) => !(m?.id != null && String(m.id) === mid)));
          setReplyingToMsg((r: any) => (r?.id != null && String(r.id) === mid ? null : r));
        })
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const updated = payload?.new;
            if (!updated?.id) return;
            setMessages((prev) => prev.map((m) => (m?.id && String(m.id) === String(updated.id) ? updated : m)));
          },
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const deleted = payload?.old;
            if (!deleted?.id) return;
            setMessages((prev) => prev.filter((m) => !(m?.id && String(m.id) === String(deleted.id))));
            if (replyingToMsg?.id && String(replyingToMsg.id) === String(deleted.id)) {
              setReplyingToMsg(null);
            }
          },
        )
        .on(
          'postgres_changes',
          // DELETE payloads may not include chat_id unless REPLICA IDENTITY is FULL,
          // so listen broadly and remove by id if it exists in the current chat state.
          { event: 'DELETE', schema: 'public', table: 'messages' },
          (payload) => {
            const deleted = payload?.old;
            if (!deleted?.id) return;
            setMessages((prev) => prev.filter((m) => !(m?.id && String(m.id) === String(deleted.id))));
            if (replyingToMsg?.id && String(replyingToMsg.id) === String(deleted.id)) {
              setReplyingToMsg(null);
            }
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'group_roles', filter: `chat_id=eq.${chatId}` },
          () => {
            void loadChat({ silent: true });
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_participants', filter: `chat_id=eq.${chatId}` },
          () => {
            void loadChat({ silent: true });
          },
        )
        .subscribe();

      realtimeChannelRef.current = channel;

      return () => {
        realtimeChannelRef.current = null;
        supabase.removeChannel(channel);
      };
    }
    return undefined;
  }, [chatId, user?.id, loadChat, scrollToBottom]);

  const sendTextMessage = async () => {
    if (!message.trim() || !user || editingMessageId !== null) return;
    if (imagePreviewUrl) return;

    const content = message.trim();
    let payloadContent = content;
    if (replyingToMsg) {
      const replyTarget =
        replyingToMsg.sender_id === user.id
          ? 'You'
          : isGroup
            ? senderNameById[replyingToMsg.sender_id] || 'User'
            : otherUser?.display_name || 'User';
      const replySnippet = getQuotedMessageLabel(replyingToMsg.content);
      if (replyingToMsg?.id) {
        payloadContent = `↪[id:${replyingToMsg.id}] ${replyTarget}: ${replySnippet}\n${content}`;
      } else {
        payloadContent = `↪ ${replyTarget}: ${replySnippet}\n${content}`;
      }
    }
    setMessage('');
    setReplyingToMsg(null);
    await insertMessage(payloadContent);
  };

  const disableComposer = editingMessageId !== null || sendingMedia || removedFromGroup;
  const hasSelectedImage = Boolean(imagePreviewUrl);

  const canToggleGif = useMemo(() => !disableComposer, [disableComposer]);
  const canToggleEmoji = useMemo(() => !disableComposer && !hasSelectedImage, [disableComposer, hasSelectedImage]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full bg-gradient-to-br from-background to-secondary/5 relative"
      onContextMenu={(e) => {
        // Hide the native context menu for right-clicks outside our message bubbles.
        const target = e.target as HTMLElement | null;
        const messageEl = target?.closest('[data-chat-message="true"]');
        if (!messageEl) {
          e.preventDefault();
          closeContextMenu();
        }
      }}
    >
      {removedFromGroup && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background/90 backdrop-blur-md px-6 text-center">
          <p className="text-lg font-semibold text-foreground">
            {groupExitKind === 'unavailable'
              ? "This chat isn't available"
              : 'You were removed from this group'}
          </p>
          <p className="text-sm text-muted-foreground max-w-sm">
            {groupExitKind === 'unavailable'
              ? 'It may have been deleted or the link is invalid.'
              : 'You can no longer send messages here.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to messages
          </button>
        </div>
      )}

      {/* Top Bar */}
      <div className="flex items-center justify-between p-4 border-b border-border/30 bg-background/80 backdrop-blur-md z-10 sticky top-0">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={onToggleProfile}>
          <Avatar
            fallback={isGroup ? chatRow?.name || 'Group' : otherUser?.display_name || '?'}
            src={isGroup ? chatRow?.avatar_url : otherUser?.avatar_url}
          />
          <div>
            <h2 className="font-semibold text-foreground group-hover:text-primary transition-colors">
              {isGroup ? chatRow?.name || 'Group' : otherUser?.display_name || 'Loading...'}
            </h2>
            <p className="text-xs text-green-500 font-medium tracking-wide">
              {isGroup ? `${Object.keys(senderNameById).length} members` : 'Online'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 text-muted-foreground">
          {!isGroup && (
            <>
              <button className="p-2 rounded-full hover:bg-secondary hover:text-foreground transition-colors hidden sm:block" type="button">
                <Phone size={20} />
              </button>
              <button className="p-2 rounded-full hover:bg-secondary hover:text-foreground transition-colors hidden sm:block" type="button">
                <Video size={20} />
              </button>
            </>
          )}
          {isGroup && (isGroupOwner || canKickMembers) && (
            <button
              type="button"
              className="p-2 rounded-full hover:bg-secondary hover:text-foreground transition-colors"
              title={isGroupOwner ? 'Group settings' : 'Manage members'}
              onClick={() => setGroupManageOpen(true)}
            >
              <Settings size={20} />
            </button>
          )}
          <button
            type="button"
            className={`p-2 rounded-full transition-colors ${isProfileOpen ? 'bg-primary/10 text-primary' : 'hover:bg-secondary hover:text-foreground'}`}
            onClick={onToggleProfile}
          >
            <Info size={20} />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div ref={messagesScrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
        {messages.map((msg, idx) => {
          const isMe = msg.sender_id === user?.id;
          const msgId = msg?.id;
          const isEditingThis = msgId && editingMessageId && String(msgId) === String(editingMessageId);
          const isMediaMessage = typeof msg.content === 'string' ? isChatMediaUrl(msg.content) : false;
          const isLeaveSystem = isGroup && typeof msg.content === 'string' && isGroupLeaveMessage(msg.content);

          if (isLeaveSystem) {
            const who =
              msg.sender_id === user?.id
                ? 'You'
                : senderNameById[msg.sender_id] || profile?.display_name || 'Someone';
            return (
              <motion.div
                key={msgId || idx}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-center w-full py-1"
                ref={(node) => {
                  if (!msgId) return;
                  messageNodeMapRef.current.set(String(msgId), node);
                }}
              >
                <div className="flex flex-col items-center gap-0.5 max-w-[min(92%,440px)]">
                  <div className="px-4 py-1.5 rounded-full bg-secondary/40 border border-border/50 shadow-sm">
                    <p className="text-xs text-center text-muted-foreground">
                      <span className="font-semibold text-foreground/90">{who}</span>
                      <span> left the group</span>
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </motion.div>
            );
          }

          return (
            <motion.div
              key={msgId || idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
              ref={(node) => {
                if (!msgId) return;
                messageNodeMapRef.current.set(String(msgId), node);
              }}
            >
              <div
                className={`flex flex-col max-w-[70%] ${isMe ? 'items-end' : 'items-start'} group ${
                  msgId && highlightedMessageId && String(msgId) === highlightedMessageId
                    ? 'ring-2 ring-primary/70 rounded-2xl shadow-[0_0_0_4px_rgba(59,130,246,0.18)] transition-all'
                    : ''
                }`}
              >
                {isGroup && (
                  <div
                    className={`flex items-center gap-2 mb-1.5 w-full ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {!isMe && onPeekUser ? (
                      <button
                        type="button"
                        onClick={() => onPeekUser(msg.sender_id)}
                        className="flex items-center gap-2 min-w-0 rounded-lg -m-1 p-1 hover:bg-secondary/60 transition-colors text-left outline-none focus-visible:ring-2 focus-visible:ring-primary flex-row"
                        aria-label={`View profile: ${senderNameById[msg.sender_id] || 'User'}`}
                      >
                        <Avatar
                          size="sm"
                          fallback={senderNameById[msg.sender_id] || 'U'}
                          src={senderAvatarById[msg.sender_id]}
                          className="ring-1 ring-border/30 shadow-sm shrink-0"
                        />
                        <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[200px]">
                          {senderNameById[msg.sender_id] || 'User'}
                        </span>
                      </button>
                    ) : (
                      <>
                        <Avatar
                          size="sm"
                          fallback={
                            isMe
                              ? profile?.display_name || profile?.username || 'You'
                              : senderNameById[msg.sender_id] || 'U'
                          }
                          src={isMe ? profile?.avatar_url ?? undefined : senderAvatarById[msg.sender_id]}
                          className="ring-1 ring-border/30 shadow-sm"
                        />
                        <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[200px]">
                          {isMe ? 'You' : senderNameById[msg.sender_id] || 'User'}
                        </span>
                      </>
                    )}
                  </div>
                )}
                <div
                  className={[
                    isMediaMessage && !isEditingThis ? 'p-0 bg-transparent border border-border/40 rounded-2xl overflow-hidden' : 'px-4 py-2.5 rounded-2xl',
                    isMediaMessage && !isEditingThis
                      ? ''
                      : isMe
                        ? 'bg-primary text-primary-foreground rounded-tr-sm shadow-md shadow-primary/20'
                        : 'bg-secondary/80 border border-border/50 text-foreground rounded-tl-sm backdrop-blur-sm',
                  ].join(' ')}
                  data-chat-message="true"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (editingMessageId !== null) {
                      closeContextMenu();
                      return;
                    }
                    if (!msgId) {
                      closeContextMenu();
                      return;
                    }
                    setContextMenuPos({ x: (e as any).clientX ?? 0, y: (e as any).clientY ?? 0 });
                    setContextMenuMsg(msg);
                    setContextMenuOpen(true);
                  }}
                >
                  {isEditingThis ? (
                    <div className="flex flex-col gap-2">
                      <input
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveEditingMessage();
                          if (e.key === 'Escape') cancelEditingMessage();
                        }}
                        className="w-full bg-background/20 border border-border/50 rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      />
                      <div className={`flex items-center gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <button
                          type="button"
                          onClick={() => void saveEditingMessage()}
                          className="px-3 py-1 text-xs rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditingMessage}
                          className="px-3 py-1 text-xs rounded-full bg-secondary/20 text-foreground hover:bg-secondary/30 transition-colors border border-border/30"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : typeof msg.content === 'string' ? (
                    renderMessageContent(msg.content)
                  ) : null}
                </div>

                <div className="flex items-center gap-2 mt-1 px-1">
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMe && !isEditingThis && (
                    <>
                      <button
                        type="button"
                        onClick={() => startReplyMessage(msg)}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-secondary/20 border border-border/30 hover:text-foreground hover:bg-secondary/30"
                        aria-label="Reply to message"
                      >
                        <CornerUpLeft size={10} />
                        Reply
                      </button>
                      {!isMediaMessage && (
                        <button
                          type="button"
                          onClick={() => startEditingMessage(msg)}
                          className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-secondary/20 border border-border/30 hover:text-foreground hover:bg-secondary/30"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void deleteMessage(msg)}
                        className="inline-flex items-center gap-1 text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 hover:text-red-300 hover:bg-red-500/15"
                        aria-label="Delete message"
                      >
                        <Trash2 size={10} />
                        Delete
                      </button>
                    </>
                  )}
                  {!isMe && !isEditingThis && canDeleteOthersMsgs && (
                    <button
                      type="button"
                      onClick={() => void deleteMessage(msg)}
                      className="inline-flex items-center gap-1 text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 hover:text-red-300"
                      aria-label="Delete message"
                    >
                      <Trash2 size={10} />
                      Delete
                    </button>
                  )}
                  {!isMe && !isEditingThis && (
                    <button
                      type="button"
                      onClick={() => startReplyMessage(msg)}
                      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-secondary/20 border border-border/30 hover:text-foreground hover:bg-secondary/30"
                      aria-label="Reply to message"
                    >
                      <CornerUpLeft size={10} />
                      Reply
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-background/80 backdrop-blur-md border-t border-border/30 relative">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
            setImageFile(file);
            setImagePreviewUrl(URL.createObjectURL(file));

            // Allow selecting the same file again.
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />

        {imagePreviewUrl && (
          <div className="mb-3 bg-secondary/20 border border-border/40 rounded-2xl p-3 flex items-start gap-3">
            <div className="h-16 w-16 rounded-xl overflow-hidden border border-border/30 bg-background/40 shrink-0">
              <img src={imagePreviewUrl} alt="Selected upload preview" className="w-full h-full object-cover" draggable={false} />
            </div>

            <div className="flex-1">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <ImageIcon size={16} className="text-primary" />
                  <span className="font-medium">Image ready to send</span>
                </div>
                <button
                  type="button"
                  onClick={cancelSelectedImage}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-secondary/60 transition-colors text-muted-foreground hover:text-foreground"
                  aria-label="Remove selected image"
                  disabled={sendingMedia}
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-xs text-muted-foreground mt-1">Press Send to upload+send, or remove it to type text.</p>
            </div>
          </div>
        )}

        {replyingToMsg && (
          <div className="mb-3 bg-secondary/20 border border-border/40 rounded-2xl p-3 flex items-start gap-3">
            <div className="mt-0.5 text-primary">
              <CornerUpLeft size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">
                Replying to{' '}
                {replyingToMsg.sender_id === user?.id
                  ? 'yourself'
                  : isGroup
                    ? senderNameById[replyingToMsg.sender_id] || 'user'
                    : otherUser?.display_name || 'user'}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {getMessagePreviewLabel(replyingToMsg.content)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReplyingToMsg(null)}
              className="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-secondary/60 transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Cancel reply"
              disabled={sendingMedia}
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 bg-secondary/30 border border-border/50 rounded-full p-1 shadow-inner focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 transition-all duration-200">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
            aria-label="Send image"
            disabled={!user || sendingMedia || editingMessageId !== null}
          >
            <Paperclip size={20} />
          </button>

          <div className="relative flex-1">
            <div className="relative">
              <div
                className={`w-full text-sm py-2.5 pr-2 min-h-[24px] pointer-events-none emoji-render ${
                  message ? 'text-foreground' : 'text-muted-foreground'
                }`}
                dangerouslySetInnerHTML={{
                  __html: message ? toEmojiHtml(message) : 'Type your message...',
                }}
              />
              <input
                type="text"
                className="absolute inset-0 w-full bg-transparent border-none focus:outline-none focus:ring-0 text-sm text-transparent caret-foreground"
                placeholder=""
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void sendTextMessage();
                }}
                disabled={hasSelectedImage || sendingMedia || editingMessageId !== null}
              />
            </div>
          </div>

          <div ref={emojiPickerWrapperRef} className="relative hidden sm:block">
            <button
              type="button"
              className="p-2.5 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
              aria-label="Emoji"
              disabled={!user || sendingMedia || editingMessageId !== null}
              onClick={() => {
                if (!canToggleEmoji) return;
                setGifOpen(false);
                setEmojiOpen((v) => !v);
              }}
            >
              <Smile size={20} />
            </button>
            {emojiOpen && (
              <div className="absolute bottom-full right-0 mb-3 z-50">
                <EmojiPicker
                  theme={Theme.DARK}
                  height={360}
                  width={340}
                  searchDisabled={false}
                  skinTonesDisabled={false}
                  previewConfig={{ showPreview: false }}
                  onEmojiClick={(emojiData) => {
                    setMessage((prev) => `${prev}${emojiData.emoji}`);
                  }}
                />
              </div>
            )}
          </div>

          <div className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => {
                if (!canToggleGif) return;
                setEmojiOpen(false);
                setGifOpen((v) => !v);
              }}
              className="p-2.5 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
              aria-label="Send GIF"
              disabled={!user || sendingMedia || editingMessageId !== null}
            >
              <Clapperboard size={20} />
            </button>
            {gifOpen && (
              <div className="absolute bottom-full right-0 mb-3 w-[420px]">
                <GifPicker
                  onClose={() => setGifOpen(false)}
                  onSelect={(gifUrl) => {
                    void sendMediaMessage(gifUrl).finally(() => setGifOpen(false));
                  }}
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => (imagePreviewUrl ? void sendSelectedImage() : void sendTextMessage())}
            disabled={
              sendingMedia ||
              editingMessageId !== null ||
              (imagePreviewUrl ? false : !message.trim())
            }
            className="p-2.5 rounded-full bg-primary text-white hover:bg-primary/90 transition-transform active:scale-95 disabled:opacity-50 disabled:active:scale-100 shrink-0 flex items-center justify-center mr-0.5 shadow-md shadow-primary/30"
          >
            <Send size={18} className="translate-x-[1px]" />
          </button>
        </div>
      </div>

      {contextMenuOpen && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[140px] rounded-xl border border-border/40 bg-background/95 backdrop-blur-xl shadow-2xl overflow-hidden"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          onMouseDown={(e) => {
            // Prevent outside-click handler from closing before click.
            e.stopPropagation();
          }}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-secondary/70 transition-colors"
            onClick={() => {
              if (!contextMenuMsg) return;
              startReplyMessage(contextMenuMsg);
            }}
          >
            Reply
          </button>
          {contextMenuMsg?.sender_id === user?.id &&
            !(typeof contextMenuMsg?.content === 'string' && isChatMediaUrl(contextMenuMsg.content)) && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-secondary/70 transition-colors"
              onClick={() => {
                if (!contextMenuMsg) return;
                startEditingMessage(contextMenuMsg);
                closeContextMenu();
              }}
            >
              Edit
            </button>
          )}
          {contextMenuMsg &&
            (contextMenuMsg.sender_id === user?.id || canDeleteOthersMsgs) && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              onClick={() => {
                if (!contextMenuMsg) return;
                void deleteMessage(contextMenuMsg);
              }}
            >
              Delete
            </button>
          )}
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-secondary/70 transition-colors"
            onClick={() => {
              closeContextMenu();
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {isGroup && (
        <GroupManageModal
          isOpen={groupManageOpen}
          onClose={() => setGroupManageOpen(false)}
          chatId={chatId}
          friends={friendsForInvite}
          isOwner={isGroupOwner}
          canKickMembers={canKickMembers}
          onChanged={() => void loadChat({ silent: true })}
          onSyncPeers={broadcastGroupSyncToPeers}
          onGroupDeleted={() => {
            setGroupManageOpen(false);
            navigate('/', { replace: true });
          }}
        />
      )}
    </div>
  );
}

