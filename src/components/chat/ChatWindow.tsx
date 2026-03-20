import { useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, Info, Loader2, Paperclip, Phone, Send, Smile, Video, Image as ImageIcon, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { Avatar } from '../ui/avatar';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { GifPicker } from './GifPicker';

interface ChatWindowProps {
  chatId: string;
  onToggleProfile: () => void;
  isProfileOpen: boolean;
}

export function ChatWindow({ chatId, onToggleProfile, isProfileOpen }: ChatWindowProps) {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [gifOpen, setGifOpen] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [otherUser, setOtherUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [editingMessageId, setEditingMessageId] = useState<string | number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [contextMenuMsg, setContextMenuMsg] = useState<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const isMediaUrl = (value: unknown): value is string => {
    if (typeof value !== 'string' || !value.trim()) return false;
    const v = value.trim();
    try {
      const u = new URL(v);
      const path = u.pathname.toLowerCase();
      return /\.(gif|png|jpe?g|webp|svg|bmp|ico)$/.test(path);
    } catch {
      // Best-effort fallback for URLs without a valid base.
      return /\.(gif|png|jpe?g|webp|svg|bmp|ico)(\?.*)?$/i.test(v);
    }
  };

  const renderMessageContent = (content: string) => {
    if (isMediaUrl(content)) {
      return (
        <img
          src={content}
          alt="Media message"
          className="w-full max-w-[520px] max-h-[340px] object-contain rounded-2xl"
          draggable={false}
        />
      );
    }

    return <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{content}</p>;
  };

  const insertMessage = async (content: string) => {
    if (!content.trim() || !user) return;

    await supabase.from('messages').insert({
      chat_id: chatId,
      sender_id: user.id,
      content: content.trim(),
    });
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
    setEditingMessageId(msgId);
    setEditingValue(typeof msg?.content === 'string' ? msg.content : '');
  };

  const cancelEditingMessage = () => {
    setEditingMessageId(null);
    setEditingValue('');
  };

  const saveEditingMessage = async () => {
    if (!editingMessageId || !user) return;

    const next = editingValue.trim();
    if (!next) return;

    try {
      await supabase.from('messages').update({ content: next }).eq('id', editingMessageId);
      cancelEditingMessage();
    } catch (e) {
      console.error('Failed to update message', e);
      alert('Failed to save message edit.');
    }
  };

  const closeContextMenu = () => {
    setContextMenuOpen(false);
    setContextMenuMsg(null);
  };

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
    if (chatId && user) {
      setLoading(true);
      loadChat();

      const channel = supabase
        .channel(`public:messages:${chatId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
          (payload) => {
            setMessages((prev) => [...prev, payload.new]);
            setTimeout(scrollToBottom, 100);
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const updated = payload?.new;
            if (!updated?.id) return;
            setMessages((prev) => prev.map((m) => (m?.id && String(m.id) === String(updated.id) ? updated : m)));
          },
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, user]);

  const loadChat = async () => {
    setLoading(true);

    const { data: participants } = await supabase
      .from('chat_participants')
      .select('users(*)')
      .eq('chat_id', chatId)
      .neq('user_id', user!.id)
      .maybeSingle();

    if (participants && participants.users) {
      setOtherUser(Array.isArray(participants.users) ? participants.users[0] : participants.users);
    }

    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (msgs) {
      setMessages(msgs);
      setTimeout(scrollToBottom, 100);
    }
    setLoading(false);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendTextMessage = async () => {
    if (!message.trim() || !user || editingMessageId !== null) return;
    if (imagePreviewUrl) return;

    const content = message.trim();
    setMessage('');
    await insertMessage(content);
  };

  const disableComposer = editingMessageId !== null || sendingMedia;
  const hasSelectedImage = Boolean(imagePreviewUrl);

  const canToggleGif = useMemo(() => !disableComposer, [disableComposer]);

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
      {/* Top Bar */}
      <div className="flex items-center justify-between p-4 border-b border-border/30 bg-background/80 backdrop-blur-md z-10 sticky top-0">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={onToggleProfile}>
          <Avatar fallback={otherUser?.display_name || '?'} src={otherUser?.avatar_url} />
          <div>
            <h2 className="font-semibold text-foreground group-hover:text-primary transition-colors">{otherUser?.display_name || 'Loading...'}</h2>
            <p className="text-xs text-green-500 font-medium tracking-wide">Online</p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 text-muted-foreground">
          <button className="p-2 rounded-full hover:bg-secondary hover:text-foreground transition-colors hidden sm:block" type="button">
            <Phone size={20} />
          </button>
          <button className="p-2 rounded-full hover:bg-secondary hover:text-foreground transition-colors hidden sm:block" type="button">
            <Video size={20} />
          </button>
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
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
        {messages.map((msg, idx) => {
          const isMe = msg.sender_id === user?.id;
          const msgId = msg?.id;
          const isEditingThis = msgId && editingMessageId && String(msgId) === String(editingMessageId);
          const isMediaMessage = typeof msg.content === 'string' ? isMediaUrl(msg.content) : false;

          return (
            <motion.div
              key={msgId || idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex flex-col max-w-[70%] ${isMe ? 'items-end' : 'items-start'} group`}>
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
                    if (!isMe) return;
                    if (editingMessageId !== null) return;
                    if (!msgId) return;

                    e.preventDefault();
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
                    <button
                      type="button"
                      onClick={() => startEditingMessage(msg)}
                      className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-full bg-secondary/20 border border-border/30 hover:text-foreground hover:bg-secondary/30"
                    >
                      Edit
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
            <input
              type="text"
              className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-sm placeholder:text-muted-foreground py-2.5"
              placeholder="Type your message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendTextMessage();
              }}
              disabled={hasSelectedImage || sendingMedia || editingMessageId !== null}
            />
          </div>

          <button
            type="button"
            className="p-2.5 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0 hidden sm:block"
            aria-label="Emoji (placeholder)"
            disabled={!user || sendingMedia || editingMessageId !== null}
            onClick={() => {
              // Emoji picker can be added later.
            }}
          >
            <Smile size={20} />
          </button>

          <button
            type="button"
            onClick={() => canToggleGif && setGifOpen((v) => !v)}
            className="p-2.5 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0 hidden sm:block"
            aria-label="Send GIF"
            disabled={!user || sendingMedia || editingMessageId !== null}
          >
            <Clapperboard size={20} />
          </button>

          <div className="relative hidden sm:block">
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
              startEditingMessage(contextMenuMsg);
              closeContextMenu();
            }}
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

