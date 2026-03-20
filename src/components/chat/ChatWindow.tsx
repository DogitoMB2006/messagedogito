import { useEffect, useState, useRef } from 'react';
import { Phone, Video, Info, Paperclip, Smile, Send, Loader2 } from 'lucide-react';
import { Avatar } from '../ui/avatar';
import { motion } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

interface ChatWindowProps {
  chatId: string;
  onToggleProfile: () => void;
  isProfileOpen: boolean;
}

export function ChatWindow({ chatId, onToggleProfile, isProfileOpen }: ChatWindowProps) {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [otherUser, setOtherUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatId && user) {
      loadChat();

      const channel = supabase.channel(`public:messages:${chatId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, (payload) => {
          setMessages(prev => [...prev, payload.new]);
          setTimeout(scrollToBottom, 100);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [chatId, user]);

  const loadChat = async () => {
    setLoading(true);
    // Get other participant
    const { data: participants } = await supabase
      .from('chat_participants')
      .select('users(*)')
      .eq('chat_id', chatId)
      .neq('user_id', user!.id)
      .maybeSingle();

    if (participants && participants.users) {
      setOtherUser(Array.isArray(participants.users) ? participants.users[0] : participants.users);
    }

    // Get messages
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

  const sendMessage = async () => {
    if (!message.trim() || !user) return;

    const content = message.trim();
    setMessage('');

    await supabase.from('messages').insert({
      chat_id: chatId,
      sender_id: user.id,
      content,
    });
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-primary" size={32} /></div>;
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-background to-secondary/5 relative">
      {/* Top Bar */}
      <div className="flex items-center justify-between p-4 border-b border-border/30 bg-background/80 backdrop-blur-md z-10 sticky top-0">
        <div 
          className="flex items-center gap-3 cursor-pointer group"
          onClick={onToggleProfile}
        >
          <Avatar fallback={otherUser?.display_name || '?'} src={otherUser?.avatar_url} />
          <div>
            <h2 className="font-semibold text-foreground group-hover:text-primary transition-colors">{otherUser?.display_name || 'Loading...'}</h2>
            <p className="text-xs text-green-500 font-medium tracking-wide">Online</p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 text-muted-foreground">
          <button className="p-2 rounded-full hover:bg-secondary hover:text-foreground transition-colors hidden sm:block">
            <Phone size={20} />
          </button>
          <button className="p-2 rounded-full hover:bg-secondary hover:text-foreground transition-colors hidden sm:block">
            <Video size={20} />
          </button>
          <button 
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
          return (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={msg.id || idx} 
              className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex flex-col max-w-[70%] ${isMe ? 'items-end' : 'items-start'}`}>
                <div 
                  className={`px-4 py-2.5 rounded-2xl ${
                    isMe 
                      ? 'bg-primary text-primary-foreground rounded-tr-sm shadow-md shadow-primary/20' 
                      : 'bg-secondary/80 border border-border/50 text-foreground rounded-tl-sm backdrop-blur-sm'
                  }`}
                >
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                </div>
                <span className="text-[10px] text-muted-foreground mt-1 px-1">
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </motion.div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-background/80 backdrop-blur-md border-t border-border/30">
        <div className="flex items-center gap-2 bg-secondary/30 border border-border/50 rounded-full p-1 shadow-inner focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 transition-all duration-200">
          <button className="p-2.5 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0">
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
                 if(e.key === 'Enter') {
                   sendMessage();
                 }
              }}
            />
          </div>
          <button className="p-2.5 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0 hidden sm:block">
            <Smile size={20} />
          </button>
          <button 
            onClick={sendMessage}
            disabled={!message.trim()}
            className="p-2.5 rounded-full bg-primary text-white hover:bg-primary/90 transition-transform active:scale-95 disabled:opacity-50 disabled:active:scale-100 shrink-0 flex items-center justify-center mr-0.5 shadow-md shadow-primary/30"
          >
            <Send size={18} className="translate-x-[1px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
