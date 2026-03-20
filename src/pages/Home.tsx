import React, { useState, useEffect } from 'react';
import { MainLayout } from '../components/layout/MainLayout';
import { ChatList } from '../components/chat/ChatList';
import { ChatWindow } from '../components/chat/ChatWindow';
import { FriendProfileSidebar } from '../components/chat/FriendProfileSidebar';
import { AnimatePresence } from 'framer-motion';
import { MessageSquareDashed } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [activeChat, setActiveChat] = useState<string | null>(searchParams.get('id'));
  const [showProfile, setShowProfile] = useState(false);
  const [activeFriendId, setActiveFriendId] = useState<string | null>(null);

  useEffect(() => {
    setActiveChat(searchParams.get('id'));
  }, [searchParams]);

  useEffect(() => {
    if (activeChat && user) {
      const getFriendId = async () => {
        const { data } = await supabase
          .from('chat_participants')
          .select('user_id')
          .eq('chat_id', activeChat)
          .neq('user_id', user.id)
          .maybeSingle();
        if (data) setActiveFriendId(data.user_id);
      };
      getFriendId();
    }
  }, [activeChat, user]);

  return (
    <MainLayout>
      <div className="flex h-full w-full overflow-hidden bg-background">
        {/* Left Side: Chats & Friends List */}
        <div className="w-full md:w-80 lg:w-[350px] shrink-0 border-r border-border/50 h-full flex flex-col">
          <ChatList 
            activeChat={activeChat} 
            onSelectChat={(id) => {
              setSearchParams({ id });
            }} 
          />
        </div>

        {/* Center: Active Chat Window */}
        <div className="flex-1 flex flex-col h-full bg-background relative overflow-hidden hidden md:flex">
          {activeChat ? (
            <ChatWindow 
              chatId={activeChat} 
              onToggleProfile={() => setShowProfile(!showProfile)} 
              isProfileOpen={showProfile}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground bg-secondary/10">
              <div className="text-center space-y-4">
                <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-secondary shadow-inner">
                  <MessageSquareDashed size={40} className="text-muted-foreground/50" />
                </div>
                <h3 className="text-xl font-semibold text-foreground tracking-tight">Your Messages</h3>
                <p className="text-sm max-w-[250px] mx-auto text-muted-foreground/80">
                  Select a chat or start a new conversation.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right Side (inner): Friend Profile Info */}
        <AnimatePresence>
          {showProfile && activeChat && activeFriendId && (
            <div className="hidden lg:block w-[300px] shrink-0 border-l border-border/50 h-full bg-background z-10 sticky top-0 right-0">
              <FriendProfileSidebar userId={activeFriendId} onClose={() => setShowProfile(false)} />
            </div>
          )}
        </AnimatePresence>
      </div>
    </MainLayout>
  );
}
