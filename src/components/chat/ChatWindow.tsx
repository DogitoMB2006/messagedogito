import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type ChatTypingRow,
  emitChatTypingBridge,
  formatTypingLabel,
  isTypingRowFresh,
  TYPING_BROADCAST_PING,
  TYPING_BROADCAST_STOP,
  type TypingBroadcastPingPayload,
  type TypingBroadcastStopPayload,
  typingBroadcastTopic,
  typingDisplayNames,
} from '../../lib/chatTyping';
import { cn } from '../../lib/utils';
import { peerPresenceLabel, peerPresenceSubtextClass, resolvePeerPresence } from '../../lib/presenceDisplay';
import { subscribePeerPresenceBroadcast } from '../../lib/presenceBroadcastBridge';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  Clapperboard,
  CornerUpLeft,
  Heart,
  Info,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Phone,
  PhoneOff,
  Send,
  Settings,
  Smile,
  Sticker,
  Trash2,
  Image as ImageIcon,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { Avatar } from '../ui/avatar';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { GifPicker } from './GifPicker';
import { StickerPicker } from './StickerPicker';
import { GroupManageModal } from './GroupManageModal';
import { SpoilerChatImage } from './SpoilerChatImage';
import { ComposerPickerSheet } from './ComposerPickerSheet';
import { TypingDots } from './TypingDots';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useSwipeToReply } from '../../hooks/useSwipeToReply';
import { GROUP_LEAVE_MESSAGE, isGroupLeaveMessage } from '../../lib/groupMessageMarkers';
import { formatChatMessageHtml } from '../../lib/chatRichText';
import {
  buildChatImageMessageContent,
  getNotificationMessageBody,
  getQuotedMessageLabel,
  isChatMediaUrl,
  parseChatMediaPayload,
  splitLeadingReply,
} from '../../lib/replyMessageFormat';
import {
  MESSAGE_ROW_INSERTED_EVENT,
  MESSAGE_ROW_UPDATED_EVENT,
  type MessageRowUpdatedDetail,
} from '../../lib/messageRowUpdated';
import { dispatchChatRead, dispatchFriendDmRead, markDmChatRead } from '../../lib/friendDmUnread';
import { useVoiceCall } from '../../contexts/VoiceCallContext';
import { whenRealtimeSubscribed } from '../../lib/whenRealtimeSubscribed';
import { httpBroadcastChatMessages } from '../../lib/chatRealtimeBroadcast';
import { sendMobilePushNotification } from '../../lib/mobilePush';
import { openExternalUrl } from '../../lib/openExternalUrl';

interface ChatWindowProps {
  chatId: string;
  onBack?: () => void;
  onToggleProfile: () => void;
  isProfileOpen: boolean;
  /** Group chats: open member profile preview (right panel on Home). */
  onPeekUser?: (userId: string) => void;
}

/** Break clusters after this gap (same sender still starts a new visual group). */
const MESSAGE_CLUSTER_GAP_MS = 5 * 60 * 1000;

/** Pixels from bottom to still count as "at latest" (hide jump button). */
const SCROLL_LATEST_THRESHOLD_PX = 120;

function isRenderedLeaveMessage(m: any, isGroup: boolean): boolean {
  return isGroup && typeof m?.content === 'string' && isGroupLeaveMessage(m.content);
}

function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

const SILENT_LOAD_KEEP_ORPHAN_MS = 120_000;

/**
 * Silent `loadChat` must not replace the whole list: postgres handlers (participants, group_roles, etc.)
 * can trigger a refetch that returns slightly stale rows and wipes a message we just merged from INSERT/broadcast.
 */
function mergeSilentServerMessages(prev: any[], server: any[] | null | undefined): any[] {
  if (server == null) return prev;
  if (server.length === 0) return [];
  const serverIds = new Set(server.map((m) => (m?.id != null ? String(m.id) : '')).filter(Boolean));
  const now = Date.now();
  const extra = prev.filter((m) => {
    if (m?.id == null) return false;
    const id = String(m.id);
    if (serverIds.has(id)) return false;
    const t = new Date((m as any).created_at).getTime();
    return Number.isFinite(t) && now - t < SILENT_LOAD_KEEP_ORPHAN_MS;
  });
  return [...server, ...extra].sort(
    (a, b) => new Date((a as any).created_at).getTime() - new Date((b as any).created_at).getTime(),
  );
}

type DesktopComposerPopoverRect = { right: number; bottom: number; width: number; maxHeight: number };

/** Anchors above the composer button; rendered in a body portal so `overflow:hidden` on the chat column does not clip the popover (search row was cut off on desktop). */
function desktopComposerPopoverRect(anchor: DOMRectReadOnly, widthCapPx: number): DesktopComposerPopoverRect {
  const width = Math.min(widthCapPx, window.innerWidth - 24);
  const maxHeight = Math.min(Math.floor(window.innerHeight * 0.72), 520);
  return {
    right: Math.max(12, window.innerWidth - anchor.right),
    bottom: window.innerHeight - anchor.top + 12,
    width,
    maxHeight,
  };
}

export function ChatWindow({ chatId, onBack, onToggleProfile, isProfileOpen, onPeekUser }: ChatWindowProps) {
  const { user, profile } = useAuth();
  const {
    phase: voicePhase,
    activeChatId: voiceActiveChatId,
    peerName: voicePeerName,
    muted: voiceMuted,
    elapsedSec: voiceElapsedSec,
    inputDevices,
    outputDevices,
    inputDeviceId,
    outputDeviceId,
    outputSwitchSupported,
    callError,
    startCall,
    endCall,
    toggleMute,
    setInputDevice,
    setOutputDevice,
    clearError,
  } = useVoiceCall();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [gifOpen, setGifOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [favStickerUrls, setFavStickerUrls] = useState<Set<string>>(new Set());
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
  const [pendingDeleteMsg, setPendingDeleteMsg] = useState<any | null>(null);
  const [deleteMessageBusy, setDeleteMessageBusy] = useState(false);
  const [deleteMessageError, setDeleteMessageError] = useState<string | null>(null);
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
  const [imageMarkSpoiler, setImageMarkSpoiler] = useState(false);
  const [pendingExternalUrl, setPendingExternalUrl] = useState<string | null>(null);
  const [replyingToMsg, setReplyingToMsg] = useState<any | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [typingPeers, setTypingPeers] = useState<Record<string, ChatTypingRow>>({});
  const [voiceDeviceMenuOpen, setVoiceDeviceMenuOpen] = useState(false);
  const [voiceDeviceMenuPos, setVoiceDeviceMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [dmVoiceStartError, setDmVoiceStartError] = useState<string | null>(null);

  const messageRef = useRef(message);
  messageRef.current = message;

  const dmPeerPresence = useMemo(() => {
    if (isGroup || !otherUser) return null;
    return resolvePeerPresence(otherUser.presence_status, otherUser.presence_updated_at);
  }, [isGroup, otherUser]);

  useEffect(() => {
    setDmVoiceStartError(null);
  }, [chatId]);

  useEffect(() => {
    return subscribePeerPresenceBroadcast((p) => {
      setOtherUser((prev: any) => {
        if (!prev || String(prev.id) !== String(p.userId)) return prev;
        return {
          ...prev,
          presence_status: p.presence_status,
          presence_updated_at: p.presence_updated_at,
        };
      });
    });
  }, []);

  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [contextMenuMsg, setContextMenuMsg] = useState<any>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  /** After switching chats, snap scroll to bottom once the thread is shown. */
  const snapToBottomAfterOpenRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerMirrorRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const emojiPickerWrapperRef = useRef<HTMLDivElement | null>(null);
  const gifPickerWrapperRef = useRef<HTMLDivElement | null>(null);
  const stickerPickerWrapperRef = useRef<HTMLDivElement | null>(null);
  const voiceDeviceAnchorRef = useRef<HTMLDivElement | null>(null);
  const voiceDevicePopoverRef = useRef<HTMLDivElement | null>(null);
  const messageNodeMapRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingBroadcastRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  /** Bumps each chat realtime effect run so stale async work cannot clear refs after a newer run. */
  const chatRealtimeSetupGenRef = useRef(0);
  /** True after we've successfully loaded this chat as a group (so a missing row = deleted, not a bad DM link). */
  const wasGroupChatRef = useRef(false);
  const isGroupRef = useRef(false);
  useEffect(() => {
    isGroupRef.current = isGroup;
  }, [isGroup]);

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

  /** Same postgres path as sidebar refresh; per-chat Realtime UPDATE can miss peers. */
  useEffect(() => {
    const onRowInserted = (e: Event) => {
      const record = (e as CustomEvent<MessageRowUpdatedDetail>).detail?.record;
      if (!record?.id || String(record.chat_id) !== String(chatId)) return;

      setMessages((prev) => mergeMessageList(prev, record));
      requestAnimationFrame(() => {
        const el = messagesScrollRef.current;
        if (el) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        } else {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      });

      if (record.sender_id && user?.id && String(record.sender_id) !== String(user.id)) {
        void markDmChatRead(supabase, chatId);
        if (isGroupRef.current) dispatchChatRead(chatId);
        else dispatchFriendDmRead(String(record.sender_id));
      }
    };

    const onRowUpdated = (e: Event) => {
      const record = (e as CustomEvent<MessageRowUpdatedDetail>).detail?.record;
      if (!record?.id || String(record.chat_id) !== String(chatId)) return;
      setMessages((prev) =>
        prev.map((m) =>
          m?.id != null && String(m.id) === String(record.id) ? { ...m, ...record } : m,
        ),
      );
    };

    window.addEventListener(MESSAGE_ROW_INSERTED_EVENT, onRowInserted);
    window.addEventListener(MESSAGE_ROW_UPDATED_EVENT, onRowUpdated);
    return () => {
      window.removeEventListener(MESSAGE_ROW_INSERTED_EVENT, onRowInserted);
      window.removeEventListener(MESSAGE_ROW_UPDATED_EVENT, onRowUpdated);
    };
  }, [chatId, user?.id]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = messagesScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
  }, []);

  const updateJumpToLatestVisibility = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpToLatest(gap > SCROLL_LATEST_THRESHOLD_PX);
  }, []);

  useEffect(() => {
    setShowJumpToLatest(false);
  }, [chatId]);

  const COMPOSER_MAX_HEIGHT_PX = 200;

  useLayoutEffect(() => {
    const mirror = composerMirrorRef.current;
    const ta = composerTextareaRef.current;
    if (!mirror || !ta) return;
    const h = Math.min(Math.max(mirror.scrollHeight, 40), COMPOSER_MAX_HEIGHT_PX);
    ta.style.height = `${h}px`;
  }, [message]);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el || loading || removedFromGroup) return;
    updateJumpToLatestVisibility();
    el.addEventListener('scroll', updateJumpToLatestVisibility, { passive: true });
    const ro = new ResizeObserver(() => updateJumpToLatestVisibility());
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateJumpToLatestVisibility);
      ro.disconnect();
    };
  }, [chatId, loading, removedFromGroup, updateJumpToLatestVisibility]);

  useEffect(() => {
    if (loading || removedFromGroup) return;
    const id = requestAnimationFrame(() => updateJumpToLatestVisibility());
    return () => cancelAnimationFrame(id);
  }, [messages.length, loading, removedFromGroup, updateJumpToLatestVisibility]);

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

  const handleMessagesLinkClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const root = messagesScrollRef.current;
    if (!root) return;
    const t = e.target as HTMLElement | null;
    if (!t || !root.contains(t)) return;
    const a = t.closest('a.chat-external-link');
    if (!a || !root.contains(a)) return;
    const href = a.getAttribute('href');
    if (!href || !/^https?:\/\//i.test(href)) return;
    e.preventDefault();
    e.stopPropagation();
    setPendingExternalUrl(href);
  }, []);

  // ── Load & toggle sticker favorites ────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('sticker_favorites')
      .select('sticker_id, stickers(url)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (!data) return;
        const urls = new Set(
          data.map((row: any) => row.stickers?.url as string).filter(Boolean)
        );
        setFavStickerUrls(urls);
      });
  }, [user?.id]);

  const toggleStickerFavByUrl = useCallback(async (stickerUrl: string) => {
    if (!user?.id) return;
    if (favStickerUrls.has(stickerUrl)) {
      // Remove
      setFavStickerUrls((prev) => { const s = new Set(prev); s.delete(stickerUrl); return s; });
      const { data } = await supabase.from('stickers').select('id').eq('url', stickerUrl).maybeSingle();
      if (data?.id) {
        await supabase.from('sticker_favorites').delete().eq('user_id', user.id).eq('sticker_id', data.id);
      }
    } else {
      // Add
      setFavStickerUrls((prev) => new Set(prev).add(stickerUrl));
      const { data } = await supabase.from('stickers').select('id').eq('url', stickerUrl).maybeSingle();
      if (data?.id) {
        await supabase.from('sticker_favorites').upsert({ user_id: user.id, sticker_id: data.id });
      }
    }
  }, [user?.id, favStickerUrls]);

  const renderMessageContent = (content: string) => {
    const replyPrefixMatch = content.match(/^↪(?:\[id:([^\]]+)\]\s)?(.+?)\n([\s\S]*)$/);
    if (replyPrefixMatch) {
      const [, replyMessageId, replyMeta, body] = replyPrefixMatch;
      return (
        <div className="space-y-2 min-w-0 max-w-full">
          <button
            type="button"
            onClick={() => {
              if (!replyMessageId) return;
              scrollToMessageById(replyMessageId);
            }}
            className={`min-w-0 max-w-full border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground text-left break-words [overflow-wrap:anywhere] ${
              replyMessageId ? 'hover:text-foreground hover:border-primary/70 transition-colors cursor-pointer' : ''
            }`}
            disabled={!replyMessageId}
            dangerouslySetInnerHTML={{ __html: toEmojiHtml(replyMeta) }}
          >
          </button>
          {(() => {
            const media = parseChatMediaPayload(body);
            if (!media) {
              return (
                <div
                  className="text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-w-0 max-w-full emoji-render"
                  dangerouslySetInnerHTML={{ __html: toEmojiHtml(body) }}
                />
              );
            }
            if (media.spoiler) return <SpoilerChatImage src={media.url} />;
            const isSticker = media.url.includes('/stickers/');
            if (isSticker) {
              const isFav = favStickerUrls.has(media.url);
              return (
                <div className="relative inline-block group/sticker">
                  <img
                    src={media.url}
                    alt="Sticker"
                    className="max-w-[128px] max-h-[128px] object-contain rounded-xl"
                    draggable={false}
                  />
                  <button
                    type="button"
                    onClick={() => void toggleStickerFavByUrl(media.url)}
                    className={`absolute bottom-1 right-1 h-7 w-7 rounded-full flex items-center justify-center shadow-md transition-all opacity-0 group-hover/sticker:opacity-100 ${
                      isFav ? 'bg-red-500/90 text-white' : 'bg-background/80 text-muted-foreground hover:text-red-400'
                    }`}
                    aria-label={isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  >
                    <Heart size={13} fill={isFav ? 'currentColor' : 'none'} />
                  </button>
                </div>
              );
            }
            return (
              <img
                src={media.url}
                alt="Media message"
                className="w-full max-w-[520px] max-h-[340px] object-contain rounded-2xl"
                draggable={false}
              />
            );
          })()}
        </div>
      );
    }

    const topMedia = parseChatMediaPayload(content);
    if (topMedia) {
      if (topMedia.spoiler) return <SpoilerChatImage src={topMedia.url} />;
      const isSticker = topMedia.url.includes('/stickers/');
      if (isSticker) {
        const isFav = favStickerUrls.has(topMedia.url);
        return (
          <div className="relative inline-block group/sticker">
            <img
              src={topMedia.url}
              alt="Sticker"
              className="max-w-[128px] max-h-[128px] object-contain rounded-xl"
              draggable={false}
            />
            <button
              type="button"
              onClick={() => void toggleStickerFavByUrl(topMedia.url)}
              className={`absolute bottom-1 right-1 h-7 w-7 rounded-full flex items-center justify-center shadow-md transition-all opacity-0 group-hover/sticker:opacity-100 ${
                isFav ? 'bg-red-500/90 text-white' : 'bg-background/80 text-muted-foreground hover:text-red-400'
              }`}
              aria-label={isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
            >
              <Heart size={13} fill={isFav ? 'currentColor' : 'none'} />
            </button>
          </div>
        );
      }
      return (
        <img
          src={topMedia.url}
          alt="Media message"
          className="w-full max-w-[520px] max-h-[340px] object-contain rounded-2xl"
          draggable={false}
        />
      );
    }

    return (
      <div
        className="text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-w-0 max-w-full emoji-render"
        dangerouslySetInnerHTML={{ __html: toEmojiHtml(content) }}
      />
    );
  };

  const getMessagePreviewLabel = (content: unknown) => getQuotedMessageLabel(content);

  const notifyRecipientsAboutMessage = useCallback(
    async (content: string) => {
      if (!user?.id) return;

      const body = getNotificationMessageBody(content);
      if (!body) return;

      if (isGroup) {
        const { data } = await supabase
          .from('chat_participants')
          .select('user_id')
          .eq('chat_id', chatId)
          .neq('user_id', user.id);

        const recipientUserIds = (data ?? []).map((row) => String(row.user_id));
        if (recipientUserIds.length === 0) return;

        await sendMobilePushNotification(supabase, {
          chatId,
          recipientUserIds,
          title: chatRow?.name || 'New group message',
          body: `${profile?.display_name || 'Someone'}: ${body}`,
          kind: 'message',
        });
        return;
      }

      if (!otherUser?.id) return;
      await sendMobilePushNotification(supabase, {
        chatId,
        recipientUserIds: [otherUser.id],
        title: profile?.display_name || 'New message',
        body,
        kind: 'message',
      });
    },
    [chatId, chatRow?.name, isGroup, otherUser?.id, profile?.display_name, user?.id],
  );

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

    try {
      await httpBroadcastChatMessages(supabase, chatId, 'message_inserted', { record: data });
    } catch (e) {
      console.warn('message_inserted http broadcast failed', e);
    }

    void notifyRecipientsAboutMessage(data.content);
  };

  const sendMediaMessage = async (contentUrl: string) => {
    setSendingMedia(true);
    try {
      await insertMessage(contentUrl);
    } finally {
      setSendingMedia(false);
    }
  };

  const uploadAndSendImage = async (file: File, opts?: { spoiler?: boolean }) => {
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

      await insertMessage(buildChatImageMessageContent(data.publicUrl, Boolean(opts?.spoiler)));
    } finally {
      setSendingMedia(false);
    }
  };

  const cancelSelectedImage = () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(null);
    setImagePreviewUrl(null);
    setImageMarkSpoiler(false);
  };

  const sendSelectedImage = async () => {
    if (!imageFile) return;
    const file = imageFile;
    const spoiler = imageMarkSpoiler;
    cancelSelectedImage();
    await uploadAndSendImage(file, { spoiler });
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
      const { data: updatedRow, error } = await supabase
        .from('messages')
        .update({ content: contentToStore })
        .eq('id', editingMessageId)
        .select('*')
        .single();

      if (error) {
        console.error('Failed to update message', error);
        alert(error.message || 'Failed to save message edit.');
        return;
      }

      if (updatedRow) {
        setMessages((prev) =>
          prev.map((m) => (m?.id != null && String(m.id) === String(updatedRow.id) ? { ...m, ...updatedRow } : m)),
        );
      }

      try {
        await httpBroadcastChatMessages(supabase, chatId, 'message_updated', { record: updatedRow });
      } catch (e) {
        console.warn('message_updated http broadcast failed', e);
      }

      cancelEditingMessage();
    } catch (e) {
      console.error('Failed to update message', e);
      alert('Failed to save message edit.');
    }
  };

  const canDeleteOthersMsgs = isGroupOwner || Boolean(myGroupRole?.can_delete_others_messages);
  const canKickMembers = isGroupOwner || Boolean(myGroupRole?.can_kick);
  const isDmCallForThisChat = !isGroup && voiceActiveChatId != null && String(voiceActiveChatId) === String(chatId);
  const canStartDmCall = !isGroup && otherUser?.id && voicePhase === 'idle';
  const dmCallBannerLabel =
    voicePhase === 'ringing-outgoing'
      ? `Calling ${voicePeerName || otherUser?.display_name || 'user'}...`
      : voicePhase === 'ringing-incoming'
        ? `${voicePeerName || otherUser?.display_name || 'User'} is calling...`
        : `In call with ${voicePeerName || otherUser?.display_name || 'user'}`;

  const dmVoiceCallButtonTitle = useMemo(() => {
    if (!otherUser?.id) return 'Loading contact…';
    if (removedFromGroup) return 'You can’t use calls in this chat';
    if (voicePhase !== 'idle') return 'Another call is already active';
    return 'Start voice call';
  }, [otherUser?.id, removedFromGroup, voicePhase]);

  const deleteMessageModalDescription = useMemo(() => {
    const msg = pendingDeleteMsg;
    if (!msg || !user) return '';
    const own = String(msg.sender_id) === String(user.id);
    if (own) {
      return isGroup
        ? 'This will permanently remove your message for everyone in the group. This cannot be undone.'
        : 'This will permanently remove your message for both of you. This cannot be undone.';
    }
    const peerName = isGroup
      ? (msg.sender_id ? senderNameById[msg.sender_id] : null) || 'this member'
      : otherUser?.display_name || 'this message';
    return `This will permanently remove ${peerName}'s message for everyone in this chat. This cannot be undone.`;
  }, [pendingDeleteMsg, user, isGroup, senderNameById, otherUser?.display_name]);

  const requestDeleteMessage = (msg: any) => {
    if (!user || !msg?.id || removedFromGroup) return;
    const isOwn = msg.sender_id === user.id;
    if (!isOwn && !canDeleteOthersMsgs) return;
    setDeleteMessageError(null);
    setPendingDeleteMsg(msg);
    closeContextMenu();
  };

  const cancelDeleteMessageModal = () => {
    if (deleteMessageBusy) return;
    setPendingDeleteMsg(null);
    setDeleteMessageError(null);
  };

  const performDeleteMessage = async () => {
    const msg = pendingDeleteMsg;
    if (!user || !msg?.id || removedFromGroup) return;
    const isOwn = msg.sender_id === user.id;
    if (!isOwn && !canDeleteOthersMsgs) return;

    setDeleteMessageBusy(true);
    setDeleteMessageError(null);

    const del = supabase.from('messages').delete().eq('id', msg.id);
    const { error } = isOwn ? await del.eq('sender_id', user.id) : await del;
    if (error) {
      console.error('Failed to delete message', error);
      setDeleteMessageError(error.message || 'Could not delete this message. Please try again.');
      setDeleteMessageBusy(false);
      return;
    }

    const mid = String(msg.id);
    setMessages((prev) => prev.filter((m) => !(m?.id != null && String(m.id) === mid)));
    if (replyingToMsg?.id && String(replyingToMsg.id) === mid) {
      setReplyingToMsg(null);
    }
    setPendingDeleteMsg(null);
    setDeleteMessageBusy(false);

    try {
      await httpBroadcastChatMessages(supabase, chatId, 'message_deleted', {
        id: msg.id,
        chat_id: chatId,
      });
    } catch (e) {
      console.warn('message_deleted http broadcast failed', e);
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

  const isMobileComposer = useMediaQuery('(max-width: 639px)');
  const [pickerLayoutTick, setPickerLayoutTick] = useState(0);
  const [gifDesktopRect, setGifDesktopRect] = useState<DesktopComposerPopoverRect | null>(null);
  const [emojiDesktopRect, setEmojiDesktopRect] = useState<DesktopComposerPopoverRect | null>(null);
  const [stickerDesktopRect, setStickerDesktopRect] = useState<DesktopComposerPopoverRect | null>(null);
  useEffect(() => {
    const onResize = () => setPickerLayoutTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    const update = () => {
      if (isMobileComposer) {
        setGifDesktopRect(null);
        setEmojiDesktopRect(null);
        setStickerDesktopRect(null);
        return;
      }
      if (gifOpen && gifPickerWrapperRef.current) {
        setGifDesktopRect(desktopComposerPopoverRect(gifPickerWrapperRef.current.getBoundingClientRect(), 420));
      } else setGifDesktopRect(null);

      if (emojiOpen && emojiPickerWrapperRef.current) {
        setEmojiDesktopRect(desktopComposerPopoverRect(emojiPickerWrapperRef.current.getBoundingClientRect(), 340));
      } else setEmojiDesktopRect(null);

      if (stickerOpen && stickerPickerWrapperRef.current) {
        setStickerDesktopRect(desktopComposerPopoverRect(stickerPickerWrapperRef.current.getBoundingClientRect(), 320));
      } else setStickerDesktopRect(null);
    };

    update();
    if (isMobileComposer) return;

    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [gifOpen, emojiOpen, stickerOpen, isMobileComposer, pickerLayoutTick]);

  useEffect(() => {
    if (!emojiOpen && !gifOpen && !stickerOpen) return;

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-composer-picker-portal]')) return;
      if (target.closest('[data-composer-popover]')) return;
      if (emojiPickerWrapperRef.current?.contains(target)) return;
      if (gifPickerWrapperRef.current?.contains(target)) return;
      if (stickerPickerWrapperRef.current?.contains(target)) return;
      setEmojiOpen(false);
      setGifOpen(false);
      setStickerOpen(false);
    };

    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEmojiOpen(false);
        setGifOpen(false);
        setStickerOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [emojiOpen, gifOpen, stickerOpen]);

  const closeVoiceDeviceMenu = useCallback(() => {
    setVoiceDeviceMenuOpen(false);
    setVoiceDeviceMenuPos(null);
  }, []);

  const updateVoiceDeviceMenuPosition = useCallback(() => {
    const el = voiceDeviceAnchorRef.current;
    const w = 288;
    const r = el?.getBoundingClientRect();
    const top = r ? r.bottom + 8 : 80;
    const left = r
      ? Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8)
      : Math.max(8, window.innerWidth / 2 - w / 2);
    setVoiceDeviceMenuPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!voiceDeviceMenuOpen) return;
    updateVoiceDeviceMenuPosition();
    window.addEventListener('scroll', updateVoiceDeviceMenuPosition, true);
    window.addEventListener('resize', updateVoiceDeviceMenuPosition);
    return () => {
      window.removeEventListener('scroll', updateVoiceDeviceMenuPosition, true);
      window.removeEventListener('resize', updateVoiceDeviceMenuPosition);
    };
  }, [voiceDeviceMenuOpen, updateVoiceDeviceMenuPosition]);

  useEffect(() => {
    if (!voiceDeviceMenuOpen) return;

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const inAnchor = voiceDeviceAnchorRef.current?.contains(target);
      const inPopover = voiceDevicePopoverRef.current?.contains(target);
      if (!inAnchor && !inPopover) closeVoiceDeviceMenu();
    };
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeVoiceDeviceMenu();
    };

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [voiceDeviceMenuOpen, closeVoiceDeviceMenu]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const loadChat = useCallback(
    async (opts?: { silent?: boolean; mountGen?: number }) => {
      const silent = opts?.silent ?? false;
      const mountGen = opts?.mountGen;
      const stale = () => mountGen != null && mountGen !== chatRealtimeSetupGenRef.current;
      const abortIfStale = () => {
        if (!stale()) return false;
        if (!silent) setLoading(false);
        return true;
      };

      if (!user) return;

      if (!silent) setLoading(true);

      const { data: chat } = await supabase.from('chats').select('*').eq('id', chatId).maybeSingle();
      if (abortIfStale()) return;

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
        if (abortIfStale()) return;

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
        if (abortIfStale()) return;

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
          if (abortIfStale()) return;
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
        if (abortIfStale()) return;

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
      if (abortIfStale()) return;

      if (msgs) {
        if (silent) {
          setMessages((prev) => mergeSilentServerMessages(prev, msgs));
        } else {
          setMessages(msgs);
        }
      }
      if (!silent) setLoading(false);
    },
    [chatId, user?.id],
  );

  useEffect(() => {
    if (!user?.id || !chatId || isGroup || removedFromGroup || loading || !otherUser?.id) return;
    void (async () => {
      await markDmChatRead(supabase, chatId);
      dispatchFriendDmRead(otherUser.id);
    })();
  }, [chatId, isGroup, removedFromGroup, loading, otherUser?.id, user?.id]);

  const broadcastGroupSyncToPeers = useCallback(() => {
    void httpBroadcastChatMessages(supabase, chatId, 'group_sync', { chatId }).catch((e) =>
      console.warn('group_sync http broadcast failed', e),
    );
  }, [chatId]);

  useEffect(() => {
    if (chatId && user?.id) {
      const setupGen = ++chatRealtimeSetupGenRef.current;
      let cancelled = false;
      setTypingPeers({});
      void loadChat({ mountGen: setupGen });

      void (async () => {
        const { data } = await supabase.from('chat_typing').select('*').eq('chat_id', chatId);
        if (cancelled || !data?.length) return;
        const next: Record<string, ChatTypingRow> = {};
        for (const row of data as ChatTypingRow[]) {
          if (String(row.user_id) === String(user.id)) continue;
          if (!isTypingRowFresh(row)) continue;
          next[String(row.user_id)] = row;
        }
        setTypingPeers(next);
      })();

      const channel = supabase
        .channel(`public:messages:${chatId}`, {
          config: { broadcast: { self: true } },
        })
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const row = payload.new as { sender_id?: string } | null;
            setMessages((prev) => mergeMessageList(prev, row));
            requestAnimationFrame(() => scrollToBottom('smooth'));
            if (row?.sender_id && user?.id && String(row.sender_id) !== String(user.id)) {
              void markDmChatRead(supabase, chatId);
              if (isGroupRef.current) dispatchChatRead(chatId);
              else dispatchFriendDmRead(String(row.sender_id));
            }
          },
        )
        .on('broadcast', { event: 'message_inserted' }, ({ payload }) => {
          const record = payload?.record as {
            id?: unknown;
            chat_id?: string;
            sender_id?: string;
          } | undefined;
          if (!record?.id || String(record.chat_id) !== String(chatId)) return;
          setMessages((prev) => mergeMessageList(prev, record));
          requestAnimationFrame(() => scrollToBottom('smooth'));
          if (record.sender_id && user?.id && String(record.sender_id) !== String(user.id)) {
            void markDmChatRead(supabase, chatId);
            if (isGroupRef.current) dispatchChatRead(chatId);
            else dispatchFriendDmRead(String(record.sender_id));
          }
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
            const updated = payload?.new as Record<string, unknown> | undefined;
            if (!updated?.id) return;
            setMessages((prev) =>
              prev.map((m) =>
                m?.id != null && String(m.id) === String(updated.id) ? { ...m, ...updated } : m,
              ),
            );
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
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, (payload) => {
          const row = payload.new as {
            id?: string;
            presence_status?: string | null;
            presence_updated_at?: string | null;
          } | null;
          if (!row?.id) return;
          setOtherUser((prev: any) => {
            if (!prev || String(prev.id) !== String(row.id)) return prev;
            return {
              ...prev,
              presence_status: row.presence_status ?? prev.presence_status,
              presence_updated_at: row.presence_updated_at ?? prev.presence_updated_at,
            };
          });
        })
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'chat_typing', filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const row = payload.new as ChatTypingRow | null;
            if (!row?.user_id || String(row.user_id) === String(user.id)) return;
            setTypingPeers((prev) => ({ ...prev, [String(row.user_id)]: row }));
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'chat_typing', filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const row = payload.new as ChatTypingRow | null;
            if (!row?.user_id || String(row.user_id) === String(user.id)) return;
            setTypingPeers((prev) => ({ ...prev, [String(row.user_id)]: row }));
          },
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'chat_typing', filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const row = payload.old as { user_id?: string } | null;
            if (!row?.user_id) return;
            const uid = String(row.user_id);
            setTypingPeers((prev) => {
              if (!prev[uid]) return prev;
              const next = { ...prev };
              delete next[uid];
              return next;
            });
          },
        );

      const typingBroadcastChannel = supabase
        .channel(typingBroadcastTopic(chatId), {
          config: { broadcast: { self: true } },
        })
        .on('broadcast', { event: TYPING_BROADCAST_PING }, ({ payload }) => {
          const p = payload as Partial<TypingBroadcastPingPayload> | null;
          if (!p?.user_id || String(p.chat_id) !== String(chatId)) return;
          if (String(p.user_id) === String(user.id)) return;
          const row: ChatTypingRow = {
            chat_id: String(chatId),
            user_id: String(p.user_id),
            display_name: typeof p.display_name === 'string' && p.display_name.trim() ? p.display_name : 'Someone',
            updated_at:
              typeof p.updated_at === 'string' && p.updated_at ? p.updated_at : new Date().toISOString(),
          };
          setTypingPeers((prev) => ({ ...prev, [row.user_id]: row }));
          emitChatTypingBridge({ kind: 'ping', chatId: String(chatId), row });
        })
        .on('broadcast', { event: TYPING_BROADCAST_STOP }, ({ payload }) => {
          const p = payload as Partial<TypingBroadcastStopPayload> | null;
          if (!p?.user_id || String(p.chat_id) !== String(chatId)) return;
          if (String(p.user_id) === String(user.id)) return;
          const uid = String(p.user_id);
          setTypingPeers((prev) => {
            if (!prev[uid]) return prev;
            const next = { ...prev };
            delete next[uid];
            return next;
          });
          emitChatTypingBridge({ kind: 'stop', chatId: String(chatId), userId: uid });
        });

      void (async () => {
        try {
          await Promise.all([
            whenRealtimeSubscribed(channel, 60_000, () => cancelled),
            whenRealtimeSubscribed(typingBroadcastChannel, 30_000, () => cancelled),
          ]);
          if (cancelled || setupGen !== chatRealtimeSetupGenRef.current) {
            void supabase.removeChannel(typingBroadcastChannel);
            void supabase.removeChannel(channel);
            return;
          }
          typingBroadcastRef.current = typingBroadcastChannel;
        } catch (e) {
          void supabase.removeChannel(typingBroadcastChannel);
          void supabase.removeChannel(channel);
          if (setupGen !== chatRealtimeSetupGenRef.current) return;
          if (!cancelled) console.warn('Chat realtime setup failed', e);
          typingBroadcastRef.current = null;
        }
      })();

      return () => {
        cancelled = true;
        typingBroadcastRef.current = null;
        supabase.removeChannel(channel);
        supabase.removeChannel(typingBroadcastChannel);
        void supabase.from('chat_typing').delete().eq('chat_id', chatId).eq('user_id', user.id);
      };
    }
    return undefined;
  }, [chatId, user?.id, loadChat, scrollToBottom]);

  const deleteMyTyping = useCallback(async () => {
    if (!user?.id || !chatId) return;
    await supabase.from('chat_typing').delete().eq('chat_id', chatId).eq('user_id', user.id);
    try {
      await typingBroadcastRef.current?.send({
        type: 'broadcast',
        event: TYPING_BROADCAST_STOP,
        payload: { chat_id: chatId, user_id: user.id } satisfies TypingBroadcastStopPayload,
      });
    } catch (e) {
      console.warn('typing_stop broadcast failed', e);
    }
  }, [chatId, user?.id]);

  const pulseMyTyping = useCallback(async () => {
    if (!user?.id || !chatId || removedFromGroup) return;
    const display_name =
      (typeof profile?.display_name === 'string' && profile.display_name.trim()) ||
      (typeof profile?.username === 'string' && profile.username.trim()) ||
      'Someone';
    const updated_at = new Date().toISOString();
    await supabase.from('chat_typing').upsert(
      {
        chat_id: chatId,
        user_id: user.id,
        display_name,
        updated_at,
      },
      { onConflict: 'chat_id,user_id' },
    );
    try {
      await typingBroadcastRef.current?.send({
        type: 'broadcast',
        event: TYPING_BROADCAST_PING,
        payload: {
          chat_id: chatId,
          user_id: user.id,
          display_name,
          updated_at,
        } satisfies TypingBroadcastPingPayload,
      });
    } catch (e) {
      console.warn('typing_ping broadcast failed', e);
    }
  }, [chatId, user?.id, profile, removedFromGroup]);

  useEffect(() => {
    const t = window.setInterval(() => {
      setTypingPeers((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (!isTypingRowFresh(next[k]!)) {
            delete next[k];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const sendTextMessage = async () => {
    if (!message.trim() || !user || editingMessageId !== null) return;
    if (imagePreviewUrl) return;

    void deleteMyTyping();

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
  const hasComposerText = message.trim().length > 0;

  useEffect(() => {
    if (!hasComposerText) {
      void deleteMyTyping();
    }
  }, [hasComposerText, deleteMyTyping]);

  useEffect(() => {
    if (!chatId || !user?.id || removedFromGroup || disableComposer || !hasComposerText) {
      return;
    }
    const tick = () => {
      if (!messageRef.current.trim()) return;
      void pulseMyTyping();
    };
    tick();
    const iv = window.setInterval(tick, 2300);
    return () => {
      window.clearInterval(iv);
      void deleteMyTyping();
    };
  }, [
    chatId,
    user?.id,
    removedFromGroup,
    disableComposer,
    hasComposerText,
    pulseMyTyping,
    deleteMyTyping,
  ]);

  const typingBannerLabel = useMemo(() => {
    const rows = Object.values(typingPeers);
    const names = typingDisplayNames(rows, user?.id);
    return formatTypingLabel(names);
  }, [typingPeers, user?.id]);

  const typingBannerRow =
    typingBannerLabel != null && typingBannerLabel !== '' ? (
      <p className="text-xs text-muted-foreground flex flex-wrap items-baseline gap-x-1 min-w-0">
        <span className="truncate">{typingBannerLabel}</span>
        <TypingDots className="inline-block w-[1.2rem] tabular-nums shrink-0" />
      </p>
    ) : null;

  const canToggleGif = useMemo(() => !disableComposer, [disableComposer]);
  const canToggleEmoji = useMemo(() => !disableComposer && !hasSelectedImage, [disableComposer, hasSelectedImage]);
  const mobileEmojiPickerWidth = useMemo(() => {
    if (typeof window === 'undefined') return 340;
    return Math.min(400, window.innerWidth - 48);
  }, [pickerLayoutTick]);

  const mobileEmojiPickerHeight = useMemo(() => {
    if (typeof window === 'undefined') return 360;
    return Math.min(420, Math.max(280, Math.floor(window.innerHeight * 0.42)));
  }, [pickerLayoutTick]);

  const { getMessageSwipeHandlers, getSwipeShiftStyle, getSwipeTrackStyle, isSwipeNearCommit } = useSwipeToReply({
    enabled: !removedFromGroup && editingMessageId === null,
    onReply: (msg) => {
      setReplyingToMsg(msg);
      closeContextMenu();
    },
  });

  const handleEmojiPicked = useCallback(
    (emoji: string) => {
      setMessage((prev) => `${prev}${emoji}`);
      if (isMobileComposer) setEmojiOpen(false);
    },
    [isMobileComposer],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full min-h-0 bg-gradient-to-br from-background to-secondary/5 relative"
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
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:p-4 border-b border-border/30 bg-background/80 backdrop-blur-md z-10 sticky top-0">
        <div className="flex min-w-0 items-center gap-3 cursor-pointer group" onClick={onToggleProfile}>
          {onBack ? (
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/40 bg-secondary/35 text-foreground transition-colors hover:bg-secondary/60 md:hidden"
              onClick={(e) => {
                e.stopPropagation();
                onBack();
              }}
              aria-label="Back to chats"
            >
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <Avatar
            fallback={isGroup ? chatRow?.name || 'Group' : otherUser?.display_name || '?'}
            src={isGroup ? chatRow?.avatar_url : otherUser?.avatar_url}
            className="h-9 w-9 md:h-10 md:w-10"
          />
          <div className="min-w-0">
            <h2 className="font-semibold text-sm md:text-base text-foreground group-hover:text-primary transition-colors truncate">
              {isGroup ? chatRow?.name || 'Group' : otherUser?.display_name || 'Loading...'}
            </h2>
            {isGroup ? (
              <div className="space-y-0.5 min-w-0 max-w-[min(100%,180px)] sm:max-w-[min(100%,320px)]">
                {typingBannerRow ? (
                  <div className="text-primary/90 [&_p]:text-primary/90" aria-hidden>
                    {typingBannerRow}
                  </div>
                ) : null}
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground">
                  {Object.keys(senderNameById).length} members
                </p>
              </div>
            ) : (
              <p
                className={cn(
                  'text-xs font-medium tracking-wide',
                  dmPeerPresence ? peerPresenceSubtextClass(dmPeerPresence) : 'text-muted-foreground',
                )}
              >
                {otherUser ? (dmPeerPresence ? peerPresenceLabel(dmPeerPresence) : 'Offline') : '…'}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 text-muted-foreground shrink-0">
          {!isGroup && (
            <button
              className="p-2 rounded-full hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
              title={dmVoiceCallButtonTitle}
              disabled={!canStartDmCall || removedFromGroup}
              onClick={() => {
                void (async () => {
                  if (!otherUser?.id) return;
                  setDmVoiceStartError(null);
                  const result = await startCall(chatId, otherUser.id, otherUser?.display_name || 'User');
                  if (!result.ok) setDmVoiceStartError(result.error);
                })();
              }}
            >
              <Phone size={20} />
            </button>
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

      {!isGroup && dmVoiceStartError ? (
        <div
          className="px-4 py-2 border-b border-destructive/25 bg-destructive/10 text-sm text-destructive flex items-start justify-between gap-3"
          role="alert"
        >
          <span className="min-w-0 break-words">{dmVoiceStartError}</span>
          <button
            type="button"
            className="shrink-0 text-xs font-medium underline underline-offset-2 hover:opacity-90"
            onClick={() => setDmVoiceStartError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {isDmCallForThisChat ? (
        <div className="relative z-30 px-4 py-2 border-b border-border/30 bg-primary/8 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{dmCallBannerLabel}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatElapsed(voiceElapsedSec)}</span>
                {callError ? <span className="text-xs text-red-300 truncate">{callError}</span> : null}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  toggleMute();
                  clearError();
                }}
                className={`inline-flex items-center justify-center h-9 w-9 rounded-full border transition-colors ${
                  voiceMuted
                    ? 'bg-amber-500/15 border-amber-500/35 text-amber-200'
                    : 'bg-secondary/30 border-border/50 text-foreground hover:bg-secondary/50'
                }`}
                title={voiceMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {voiceMuted ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
              <div className="relative" ref={voiceDeviceAnchorRef}>
                <button
                  type="button"
                  onClick={() => {
                    if (voiceDeviceMenuOpen) {
                      closeVoiceDeviceMenu();
                    } else {
                      updateVoiceDeviceMenuPosition();
                      setVoiceDeviceMenuOpen(true);
                    }
                  }}
                  className="inline-flex items-center justify-center h-9 w-8 rounded-full border border-border/50 bg-secondary/30 text-foreground hover:bg-secondary/50 transition-colors"
                  title="Audio devices"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              {voiceDeviceMenuOpen
                ? createPortal(
                    <div
                      ref={voiceDevicePopoverRef}
                      role="dialog"
                      aria-label="Audio devices"
                      className="fixed z-[200] w-72 rounded-xl border border-border/50 bg-background/98 backdrop-blur-md p-3 shadow-2xl space-y-3 pointer-events-auto"
                      style={{
                        top: (voiceDeviceMenuPos ?? { top: 80, left: 24 }).top,
                        left: (voiceDeviceMenuPos ?? { top: 80, left: 24 }).left,
                      }}
                    >
                      <div className="space-y-1.5">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Input</p>
                        <div className="max-h-36 overflow-y-auto rounded-lg border border-border/50 bg-secondary/20 p-0.5 space-y-0.5">
                          <button
                            type="button"
                            onClick={() => void setInputDevice('')}
                            className={cn(
                              'w-full text-left text-xs rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/60',
                              !inputDeviceId ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground/90',
                            )}
                          >
                            Default microphone
                          </button>
                          {inputDevices.map((d) => {
                            const id = d.deviceId;
                            const active = inputDeviceId === id;
                            return (
                              <button
                                key={id || d.label}
                                type="button"
                                onClick={() => void setInputDevice(id)}
                                className={cn(
                                  'w-full text-left text-xs rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/60 truncate',
                                  active ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground/90',
                                )}
                                title={d.label || 'Microphone'}
                              >
                                {d.label || 'Microphone'}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Output</p>
                        <div
                          className={cn(
                            'max-h-36 overflow-y-auto rounded-lg border border-border/50 p-0.5 space-y-0.5',
                            outputSwitchSupported ? 'bg-secondary/20' : 'bg-secondary/10 opacity-60',
                          )}
                        >
                          <button
                            type="button"
                            disabled={!outputSwitchSupported}
                            onClick={() => void setOutputDevice('')}
                            className={cn(
                              'w-full text-left text-xs rounded-md px-2 py-1.5 transition-colors',
                              outputSwitchSupported ? 'hover:bg-secondary/60' : 'cursor-not-allowed',
                              !outputDeviceId && outputSwitchSupported
                                ? 'bg-primary/15 text-foreground font-medium'
                                : 'text-foreground/90',
                            )}
                          >
                            Default output
                          </button>
                          {outputDevices.map((d) => {
                            const id = d.deviceId;
                            const active = outputDeviceId === id;
                            return (
                              <button
                                key={id || d.label}
                                type="button"
                                disabled={!outputSwitchSupported}
                                onClick={() => void setOutputDevice(id)}
                                className={cn(
                                  'w-full text-left text-xs rounded-md px-2 py-1.5 transition-colors truncate',
                                  outputSwitchSupported ? 'hover:bg-secondary/60' : 'cursor-not-allowed',
                                  active && outputSwitchSupported
                                    ? 'bg-primary/15 text-foreground font-medium'
                                    : 'text-foreground/90',
                                )}
                                title={d.label || 'Speaker'}
                              >
                                {d.label || 'Speaker'}
                              </button>
                            );
                          })}
                        </div>
                        {!outputSwitchSupported ? (
                          <p className="text-[10px] text-muted-foreground">
                            Output switching is not supported by this browser.
                          </p>
                        ) : null}
                      </div>
                    </div>,
                    document.body,
                  )
                : null}
              <button
                type="button"
                onClick={() => void endCall()}
                className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-red-500/35 bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
                title="Leave call"
              >
                <PhoneOff size={16} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Messages Area (z-0 so in-call popovers above paint under sibling overlap) */}
      <div className="relative z-0 flex-1 min-h-0 flex flex-col">
        <div
          ref={messagesScrollRef}
          className="flex-1 min-h-0 overflow-y-auto px-3 py-3 sm:p-4 flex flex-col custom-scrollbar"
          onClickCapture={handleMessagesLinkClick}
        >
        {messages.map((msg, idx) => {
          const isMe = msg.sender_id === user?.id;
          const msgId = msg?.id;
          const isEditingThis = msgId && editingMessageId && String(msgId) === String(editingMessageId);
          const isMediaMessage = typeof msg.content === 'string' ? isChatMediaUrl(msg.content) : false;
          const isLeaveSystem = isGroup && typeof msg.content === 'string' && isGroupLeaveMessage(msg.content);

          const immPrev = idx > 0 ? messages[idx - 1] : null;
          const immPrevIsLeave = immPrev ? isRenderedLeaveMessage(immPrev, isGroup) : false;
          const timeGapBreak =
            !!immPrev &&
            !immPrevIsLeave &&
            new Date(msg.created_at).getTime() - new Date(immPrev.created_at).getTime() >
              MESSAGE_CLUSTER_GAP_MS;
          const sameSenderRun =
            !!immPrev &&
            !immPrevIsLeave &&
            !timeGapBreak &&
            String(immPrev.sender_id) === String(msg.sender_id);
          const runStart = !sameSenderRun;
          const clusterGapClass =
            idx === 0 ? '' : sameSenderRun ? 'mt-1' : immPrevIsLeave ? 'mt-3' : 'mt-5';
          const leaveGapClass = idx === 0 ? '' : immPrevIsLeave ? 'mt-2' : 'mt-4';

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
                className={`flex justify-center w-full py-1 ${leaveGapClass}`}
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
              className={`relative w-full flex ${isMe ? 'justify-end' : 'justify-start'} ${clusterGapClass}${isMobileComposer ? ' touch-pan-y' : ''}`}
              ref={(node) => {
                if (!msgId) return;
                messageNodeMapRef.current.set(String(msgId), node);
              }}
              {...getMessageSwipeHandlers(msg)}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 z-0 flex w-11 items-center justify-center sm:w-12"
                style={getSwipeTrackStyle(msg)}
              >
                <div
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-md sm:h-10 sm:w-10',
                    'border-primary/35 bg-primary/20 shadow-md shadow-black/15',
                    'dark:border-primary/40 dark:bg-primary/25 dark:shadow-black/40',
                    isSwipeNearCommit(msg) && 'ring-2 ring-primary/60 shadow-lg shadow-primary/25',
                  )}
                  style={{ transition: 'box-shadow 0.18s ease, filter 0.18s ease' }}
                >
                  <CornerUpLeft className="text-primary drop-shadow-sm" size={18} strokeWidth={2.35} />
                </div>
              </div>
              <div
                className={cn(
                  `relative z-[1] flex min-w-0 items-start max-w-[min(86vw,30rem)] md:max-w-[min(70%,28rem)] gap-2.5 ${isGroup ? (isMe ? 'flex-row-reverse' : 'flex-row') : isMe ? 'flex-row-reverse' : 'flex-row'}`,
                  msgId && highlightedMessageId && String(msgId) === highlightedMessageId
                    ? 'ring-2 ring-primary/70 rounded-2xl shadow-[0_0_0_4px_rgba(59,130,246,0.18)] transition-all'
                    : '',
                  'group',
                )}
                style={getSwipeShiftStyle(msg)}
              >
                {isGroup && (
                  <div
                    className={`w-8 shrink-0 flex flex-col ${isMe ? 'items-end' : 'items-start'} ${sameSenderRun ? 'pt-8' : 'pt-1'}`}
                  >
                    {runStart ? (
                      !isMe && onPeekUser ? (
                        <button
                          type="button"
                          onClick={() => onPeekUser(msg.sender_id)}
                          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
                          aria-label={`View profile: ${senderNameById[msg.sender_id] || 'User'}`}
                        >
                          <Avatar
                            size="sm"
                            fallback={senderNameById[msg.sender_id] || 'U'}
                            src={senderAvatarById[msg.sender_id]}
                            className="ring-1 ring-border/30 shadow-sm"
                          />
                        </button>
                      ) : (
                        <Avatar
                          size="sm"
                          fallback={
                            isMe
                              ? profile?.display_name || profile?.username || 'You'
                              : senderNameById[msg.sender_id] || 'U'
                          }
                          src={isMe ? profile?.avatar_url ?? undefined : senderAvatarById[msg.sender_id]}
                          className="ring-1 ring-border/30 shadow-sm shrink-0"
                        />
                      )
                    ) : (
                      <span className="block w-8 h-8 shrink-0 opacity-0" aria-hidden />
                    )}
                  </div>
                )}
                <div
                  className={`flex flex-col min-w-0 max-w-full ${isMe ? 'items-end' : 'items-start'}`}
                >
                  {isGroup && runStart && (
                    <div
                      className={`flex items-center gap-2 mb-1.5 w-full min-w-0 ${isMe ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isMe && onPeekUser ? (
                        <button
                          type="button"
                          onClick={() => onPeekUser(msg.sender_id)}
                          className="text-[11px] font-medium text-muted-foreground truncate max-w-full rounded-md px-1 py-0.5 -mx-1 hover:bg-secondary/60 transition-colors text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={`View profile: ${senderNameById[msg.sender_id] || 'User'}`}
                        >
                          {senderNameById[msg.sender_id] || 'User'}
                        </button>
                      ) : (
                        <span className="text-[11px] font-medium text-muted-foreground truncate max-w-[220px]">
                          {isMe ? 'You' : senderNameById[msg.sender_id] || 'User'}
                        </span>
                      )}
                    </div>
                  )}
                <div
                  className={[
                    isMediaMessage && !isEditingThis ? 'p-0 bg-transparent border border-border/40 rounded-2xl overflow-hidden' : 'px-4 py-3 md:py-2.5 rounded-2xl',
                    isMediaMessage && !isEditingThis
                      ? ''
                      : isMe
                        ? 'bg-primary text-primary-foreground rounded-tr-sm shadow-md shadow-primary/20'
                        : 'bg-secondary/80 border border-border/50 text-foreground rounded-tl-sm backdrop-blur-sm',
                    !isMediaMessage || isEditingThis ? 'min-w-0 max-w-full overflow-hidden' : '',
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
                    <div className="flex flex-col gap-2 min-w-0 max-w-full">
                      <textarea
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void saveEditingMessage();
                          }
                          if (e.key === 'Escape') cancelEditingMessage();
                        }}
                        rows={3}
                        className="w-full min-w-0 max-w-full resize-y bg-background/20 border border-border/50 rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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

                <div className={`flex items-center gap-1.5 px-1.5 ${sameSenderRun ? 'mt-0.5' : 'mt-1'}`}>
                  <span className="text-[10px] text-muted-foreground/90">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMe && !isEditingThis && (
                    <>
                      <button
                        type="button"
                        onClick={() => startReplyMessage(msg)}
                        className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-secondary/20 border border-border/30 hover:text-foreground hover:bg-secondary/30"
                        aria-label="Reply to message"
                      >
                        <CornerUpLeft size={10} />
                        Reply
                      </button>
                      {!isMediaMessage && (
                        <button
                          type="button"
                          onClick={() => startEditingMessage(msg)}
                            className="hidden sm:inline-flex text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-secondary/20 border border-border/30 hover:text-foreground hover:bg-secondary/30"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => requestDeleteMessage(msg)}
                        className="hidden sm:inline-flex items-center gap-1 text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 hover:text-red-300 hover:bg-red-500/15"
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
                      onClick={() => requestDeleteMessage(msg)}
                      className="hidden sm:inline-flex items-center gap-1 text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 hover:text-red-300"
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
                      className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-secondary/20 border border-border/30 hover:text-foreground hover:bg-secondary/30"
                      aria-label="Reply to message"
                    >
                      <CornerUpLeft size={10} />
                      Reply
                    </button>
                  )}
                </div>
                </div>
              </div>
            </motion.div>
          );
        })}
        <div ref={messagesEndRef} />
        </div>

        {showJumpToLatest ? (
          <motion.button
            type="button"
            aria-label="Jump to latest message"
            title="Latest messages"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className={cn(
              'absolute bottom-4 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full',
              'border border-border/60 bg-background/95 text-foreground shadow-lg backdrop-blur-md',
              'ring-1 ring-black/5 dark:ring-white/10',
              'hover:border-primary/45 hover:bg-primary/12 hover:text-primary transition-colors',
            )}
            onClick={() => {
              scrollToBottom('smooth');
              window.setTimeout(() => updateJumpToLatestVisibility(), 450);
            }}
          >
            <ChevronDown className="h-5 w-5" strokeWidth={2.25} />
          </motion.button>
        ) : null}
      </div>

      {/* Input Area */}
      <div className="px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:p-4 bg-background/80 backdrop-blur-md border-t border-border/30 relative">
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
            setImageMarkSpoiler(false);
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

              <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-xl border border-border/40 bg-background/30 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                  checked={imageMarkSpoiler}
                  onChange={(e) => setImageMarkSpoiler(e.target.checked)}
                  disabled={sendingMedia}
                />
                <span className="text-xs text-foreground leading-snug">
                  Mark as spoiler — image stays blurred until someone taps to reveal
                </span>
              </label>
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

        {typingBannerRow ? (
          <div
            className="mb-2 min-h-[1.25rem] flex items-center text-foreground/85 [&_p]:text-foreground/85"
            aria-live="polite"
          >
            {typingBannerRow}
          </div>
        ) : null}

        <div className="flex items-end gap-1.5 sm:gap-2 bg-secondary/30 border border-border/50 rounded-[1.7rem] sm:rounded-3xl p-1.5 sm:p-1 shadow-inner focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 transition-all duration-200 min-w-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
            aria-label="Send image"
            disabled={!user || sendingMedia || editingMessageId !== null}
          >
            <Paperclip size={18} />
          </button>

          <div className="relative flex-1 min-w-0 py-1">
            <div className="relative min-w-0">
              <div
                ref={composerMirrorRef}
                className={`w-full min-w-0 max-w-full text-[15px] sm:text-sm py-2 pr-2 pl-0.5 min-h-[40px] max-h-[200px] overflow-y-auto overflow-x-hidden pointer-events-none whitespace-pre-wrap break-words [overflow-wrap:anywhere] emoji-render [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                  message ? 'text-foreground' : 'text-muted-foreground'
                }`}
                dangerouslySetInnerHTML={{
                  __html: message ? toEmojiHtml(message) : 'Type your message…',
                }}
              />
              <textarea
                ref={composerTextareaRef}
                className="absolute left-0 right-0 top-0 w-full min-w-0 max-h-[200px] resize-none bg-transparent border-none focus:outline-none focus:ring-0 text-[15px] sm:text-sm text-transparent caret-foreground py-2 pr-2 pl-0.5 overflow-y-auto overflow-x-hidden custom-scrollbar"
                placeholder=""
                rows={1}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onScroll={(e) => {
                  const m = composerMirrorRef.current;
                  if (m) m.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendTextMessage();
                  }
                }}
                disabled={hasSelectedImage || sendingMedia || editingMessageId !== null}
                aria-label="Message"
              />
            </div>
          </div>

          <div ref={emojiPickerWrapperRef} className="relative block shrink-0">
            <button
              type="button"
              className="p-2 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
              aria-label="Emoji"
              disabled={!user || sendingMedia || editingMessageId !== null}
              onClick={() => {
                if (!canToggleEmoji) return;
                setGifOpen(false);
                setStickerOpen(false);
                setEmojiOpen((v) => !v);
              }}
            >
              <Smile size={18} />
            </button>
            <ComposerPickerSheet
              open={emojiOpen && isMobileComposer}
              onClose={() => setEmojiOpen(false)}
            >
              <div className="flex min-h-0 min-w-0 flex-1 justify-center overflow-auto bg-background">
                <EmojiPicker
                  theme={Theme.DARK}
                  height={mobileEmojiPickerHeight}
                  width={mobileEmojiPickerWidth}
                  searchDisabled={false}
                  skinTonesDisabled={false}
                  previewConfig={{ showPreview: false }}
                  onEmojiClick={(emojiData) => {
                    handleEmojiPicked(emojiData.emoji);
                  }}
                />
              </div>
            </ComposerPickerSheet>
            {emojiOpen && !isMobileComposer && emojiDesktopRect
              ? createPortal(
                  <div
                    data-composer-popover
                    className="pointer-events-auto fixed z-[100] flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-background/98 shadow-2xl backdrop-blur-xl"
                    style={{
                      right: emojiDesktopRect.right,
                      bottom: emojiDesktopRect.bottom,
                      width: emojiDesktopRect.width,
                      maxHeight: emojiDesktopRect.maxHeight,
                    }}
                  >
                    <EmojiPicker
                      theme={Theme.DARK}
                      height={Math.min(360, emojiDesktopRect.maxHeight)}
                      width={emojiDesktopRect.width}
                      searchDisabled={false}
                      skinTonesDisabled={false}
                      previewConfig={{ showPreview: false }}
                      onEmojiClick={(emojiData) => {
                        handleEmojiPicked(emojiData.emoji);
                      }}
                    />
                  </div>,
                  document.body,
                )
              : null}
          </div>

          <div ref={gifPickerWrapperRef} className="relative block shrink-0">
            <button
              type="button"
              onClick={() => {
                if (!canToggleGif) return;
                setEmojiOpen(false);
                setStickerOpen(false);
                setGifOpen((v) => !v);
              }}
              className="p-2 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
              aria-label="Send GIF"
              disabled={!user || sendingMedia || editingMessageId !== null}
            >
              <Clapperboard size={18} />
            </button>
            <ComposerPickerSheet open={gifOpen && isMobileComposer} onClose={() => setGifOpen(false)}>
              <GifPicker
                className="h-full max-w-none min-h-0 flex-1 rounded-none border-0 shadow-none"
                onClose={() => setGifOpen(false)}
                onSelect={(gifUrl) => {
                  void sendMediaMessage(gifUrl).finally(() => setGifOpen(false));
                }}
              />
            </ComposerPickerSheet>
            {gifOpen && !isMobileComposer && gifDesktopRect
              ? createPortal(
                  <div
                    data-composer-popover
                    className="pointer-events-auto fixed z-[100] flex min-h-0 max-h-full flex-col"
                    style={{
                      right: gifDesktopRect.right,
                      bottom: gifDesktopRect.bottom,
                      width: gifDesktopRect.width,
                      maxHeight: gifDesktopRect.maxHeight,
                    }}
                  >
                    <GifPicker
                      autoFocusSearch
                      className="min-h-0 min-w-0 flex-1 max-h-full rounded-2xl"
                      onClose={() => setGifOpen(false)}
                      onSelect={(gifUrl) => {
                        void sendMediaMessage(gifUrl).finally(() => setGifOpen(false));
                      }}
                    />
                  </div>,
                  document.body,
                )
              : null}
          </div>

          <div ref={stickerPickerWrapperRef} className="relative block shrink-0">
            <button
              type="button"
              onClick={() => {
                setEmojiOpen(false);
                setGifOpen(false);
                setStickerOpen((v) => !v);
              }}
              className="p-2 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
              aria-label="Stickers"
              disabled={!user || sendingMedia || editingMessageId !== null}
            >
              <Sticker size={18} />
            </button>
            <ComposerPickerSheet open={stickerOpen && isMobileComposer} onClose={() => setStickerOpen(false)}>
              <StickerPicker
                className="h-full max-w-none min-h-0 flex-1 rounded-none border-0 shadow-none"
                onClose={() => setStickerOpen(false)}
                onSelect={(url) => {
                  void sendMediaMessage(url).finally(() => setStickerOpen(false));
                }}
              />
            </ComposerPickerSheet>
            {stickerOpen && !isMobileComposer && stickerDesktopRect
              ? createPortal(
                  <div
                    data-composer-popover
                    className="pointer-events-auto fixed z-[100] flex min-h-0 max-h-full flex-col"
                    style={{
                      right: stickerDesktopRect.right,
                      bottom: stickerDesktopRect.bottom,
                      width: stickerDesktopRect.width,
                      maxHeight: stickerDesktopRect.maxHeight,
                    }}
                  >
                    <StickerPicker
                      className="min-h-0 min-w-0 flex-1 max-h-full rounded-2xl"
                      onClose={() => setStickerOpen(false)}
                      onSelect={(url) => {
                        void sendMediaMessage(url).finally(() => setStickerOpen(false));
                      }}
                    />
                  </div>,
                  document.body,
                )
              : null}
          </div>

          <button
            type="button"
            onClick={() => (imagePreviewUrl ? void sendSelectedImage() : void sendTextMessage())}
            disabled={
              sendingMedia ||
              editingMessageId !== null ||
              (imagePreviewUrl ? false : !message.trim())
            }
            className="p-2 rounded-full bg-primary text-white hover:bg-primary/90 transition-transform active:scale-95 disabled:opacity-50 disabled:active:scale-100 shrink-0 flex items-center justify-center mr-0.5 shadow-md shadow-primary/30"
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
                requestDeleteMessage(contextMenuMsg);
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

      <Modal
        isOpen={pendingDeleteMsg != null}
        onClose={cancelDeleteMessageModal}
        title="Delete message?"
        description={deleteMessageModalDescription}
        size="sm"
      >
        {deleteMessageError ? (
          <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
            {deleteMessageError}
          </p>
        ) : null}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <Button type="button" variant="outline" disabled={deleteMessageBusy} onClick={cancelDeleteMessageModal}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={deleteMessageBusy}
            className="gap-2 border border-red-500/30 shadow-sm shadow-red-900/20"
            onClick={() => void performDeleteMessage()}
          >
            {deleteMessageBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
            {deleteMessageBusy ? 'Deleting…' : 'Delete message'}
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={pendingExternalUrl != null}
        onClose={() => setPendingExternalUrl(null)}
        title="Open external link?"
        description="You’re about to leave this app and open a website. Only continue if you trust the link."
        size="sm"
      >
        {pendingExternalUrl ? (
          <p className="text-xs text-muted-foreground break-all rounded-lg border border-border/40 bg-secondary/20 px-3 py-2 mb-4 font-mono">
            {pendingExternalUrl}
          </p>
        ) : null}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => setPendingExternalUrl(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              const url = pendingExternalUrl;
              setPendingExternalUrl(null);
              if (url) void openExternalUrl(url);
            }}
          >
            Open anyway
          </Button>
        </div>
      </Modal>

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
