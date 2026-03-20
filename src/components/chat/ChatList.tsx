import React, { useEffect, useState } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import { Input } from '../ui/input';
import { Avatar } from '../ui/avatar';
import { cn } from '../../lib/utils';
import { motion } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface ChatListProps {
  activeChat: string | null;
  onSelectChat: (id: string) => void;
}

export function ChatList({ activeChat, onSelectChat }: ChatListProps) {
  const { user } = useAuth();
  const [chats, setChats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      loadChats();
      // Subscribe to messages changes across all chats I am in
      const channel = supabase.channel('public:messages:all')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
          loadChats(); // Reload to update last messages
        })
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    }
  }, [user]);

  const loadChats = async () => {
    if (!user) return;
    
    // 1. Get my chat IDs
    const { data: myParticipants } = await supabase.from('chat_participants').select('chat_id').eq('user_id', user.id);
    if (!myParticipants || myParticipants.length === 0) {
      setChats([]);
      setLoading(false);
      return;
    }
    
    const chatIds = myParticipants.map(p => p.chat_id);
    
    // 2. Get the other participant in these chats
    const { data: otherParticipants } = await supabase
      .from('chat_participants')
      .select('chat_id, users:users(*)')
      .in('chat_id', chatIds)
      .neq('user_id', user.id);
      
    if (!otherParticipants) {
      setLoading(false);
      return;
    }

    // 3. Get all messages for these chats to find the last message
    // Note: In a production app, you'd use a dedicated SQL View or RPC
    const { data: messages } = await supabase
      .from('messages')
      .select('chat_id, content, created_at')
      .in('chat_id', chatIds)
      .order('created_at', { ascending: false });

    const mapped = otherParticipants.map(p => {
      const otherUser = Array.isArray(p.users) ? p.users[0] : p.users;
      const chatMessages = messages?.filter(m => m.chat_id === p.chat_id) || [];
      const lastMessage = chatMessages.length > 0 ? chatMessages[0] : null;

      return {
        id: p.chat_id,
        name: otherUser?.display_name || 'Unknown User',
        avatar: otherUser?.avatar_url,
        lastMessage: lastMessage?.content || 'Started a chat',
        time: lastMessage ? new Date(lastMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        unread: 0,
        isOnline: true, // Mock online status
        lastMsgTimeRaw: lastMessage ? new Date(lastMessage.created_at).getTime() : 0,
        otherUserId: otherUser?.id,
      };
    });

    mapped.sort((a, b) => b.lastMsgTimeRaw - a.lastMsgTimeRaw);
    setChats(mapped);
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-full bg-background/50 backdrop-blur-sm">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-border/30">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Messages</h1>
        <button onClick={() => navigate('/friends')} className="h-9 w-9 flex items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
          <Plus size={20} />
        </button>
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
              onClick={() => onSelectChat(chat.id)}
              className={cn(
                "relative flex flex-row items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors duration-200 group",
                activeChat === chat.id 
                  ? "bg-primary/10 before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-1 before:h-8 before:bg-primary before:rounded-r-full" 
                  : "hover:bg-secondary/40"
              )}
            >
              <div className="relative shrink-0">
                <Avatar fallback={chat.name} src={chat.avatar} />
                {chat.isOnline && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 border-2 border-background bg-green-500 rounded-full" />
                )}
              </div>
              
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="font-semibold text-sm truncate text-foreground">{chat.name}</span>
                  <span className={cn("text-xs whitespace-nowrap ml-2", chat.unread > 0 ? "text-primary font-medium" : "text-muted-foreground")}>
                    {chat.time}
                  </span>
                </div>
                <p className={cn("text-xs truncate", chat.unread > 0 ? "text-foreground font-medium" : "text-muted-foreground")}>
                  {chat.lastMessage}
                </p>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
