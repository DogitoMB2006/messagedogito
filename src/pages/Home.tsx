import { useState, useEffect } from 'react';
import { MainLayout } from '../components/layout/MainLayout';
import { ChatList } from '../components/chat/ChatList';
import { ChatWindow } from '../components/chat/ChatWindow';
import { FriendProfileSidebar } from '../components/chat/FriendProfileSidebar';
import { GroupProfileSidebar } from '../components/chat/GroupProfileSidebar';
import { UserPeekSidebar } from '../components/chat/UserPeekSidebar';
import { MessageSquareDashed } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { setActiveChatIdForNotifications } from '../lib/activeChatScope';

export function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [activeChat, setActiveChat] = useState<string | null>(searchParams.get('id'));
  const [showProfile, setShowProfile] = useState(false);
  const [peekUserId, setPeekUserId] = useState<string | null>(null);
  const [activeFriendId, setActiveFriendId] = useState<string | null>(null);
  const [activeChatIsGroup, setActiveChatIsGroup] = useState(false);
  const mobileProfileOpen = Boolean(activeChat && ((peekUserId && activeChat) || (showProfile && (activeChatIsGroup || activeFriendId))));

  const clearActiveChat = () => {
    setShowProfile(false);
    setPeekUserId(null);
    setSearchParams({});
  };

  useEffect(() => {
    setActiveChat(searchParams.get('id'));
  }, [searchParams]);

  useEffect(() => {
    setActiveChatIdForNotifications(activeChat);
    return () => setActiveChatIdForNotifications(null);
  }, [activeChat]);

  useEffect(() => {
    setPeekUserId(null);
  }, [activeChat]);

  useEffect(() => {
    if (!activeChat || !user) {
      setActiveFriendId(null);
      setActiveChatIsGroup(false);
      return;
    }
    (async () => {
      const { data: chat } = await supabase.from('chats').select('is_group').eq('id', activeChat).maybeSingle();
      const isGroup = Boolean(chat?.is_group);
      setActiveChatIsGroup(isGroup);
      if (isGroup) {
        setActiveFriendId(null);
        return;
      }
      const { data } = await supabase
        .from('chat_participants')
        .select('user_id')
        .eq('chat_id', activeChat)
        .neq('user_id', user.id)
        .maybeSingle();
      setActiveFriendId(data?.user_id ?? null);
    })();
  }, [activeChat, user]);

  return (
    <MainLayout>
      <div className="flex h-full w-full overflow-hidden bg-background">
        {/* Left Side: Chats & Friends List */}
        <div className={`${activeChat ? 'hidden md:flex' : 'flex'} w-full md:w-80 lg:w-[350px] shrink-0 border-r border-border/50 h-full flex-col`}>
          <ChatList
            activeChat={activeChat}
            onSelectChat={(id) => {
              setSearchParams({ id });
            }}
            onClearActiveIfMatch={(leftChatId) => {
              if (activeChat === leftChatId) setSearchParams({});
            }}
          />
        </div>

        {/* Center: Active Chat Window */}
        <div className={`${activeChat ? 'flex' : 'hidden md:flex'} flex-1 flex-col h-full bg-background relative overflow-hidden`}>
          {activeChat ? (
            <ChatWindow 
              chatId={activeChat} 
              onBack={clearActiveChat}
              onToggleProfile={() => {
                setPeekUserId(null);
                setShowProfile((p) => !p);
              }} 
              isProfileOpen={showProfile}
              onPeekUser={(id) => {
                setShowProfile(false);
                setPeekUserId(id);
              }}
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

        {/* Right Side (inner): member peek (group) / profile / group info */}
        {((peekUserId && activeChat) || (showProfile && activeChat && (activeChatIsGroup || activeFriendId))) && (
          <>
            <button
              type="button"
              aria-label="Close profile panel overlay"
              className="hidden md:block absolute inset-y-0 left-0 right-20 bg-black/35 z-20"
              onClick={() => {
                setShowProfile(false);
                setPeekUserId(null);
              }}
            />
            <div className="hidden md:block absolute top-0 right-20 h-full w-[300px] border-l border-border/50 bg-background z-30 shadow-[-12px_0_30px_rgba(0,0,0,0.25)]">
              {peekUserId ? (
                <UserPeekSidebar userId={peekUserId} onClose={() => setPeekUserId(null)} />
              ) : activeChatIsGroup ? (
                <GroupProfileSidebar
                  chatId={activeChat}
                  onClose={() => setShowProfile(false)}
                  onLeftGroup={() => {
                    setShowProfile(false);
                    setSearchParams({});
                  }}
                />
              ) : (
                <FriendProfileSidebar userId={activeFriendId!} onClose={() => setShowProfile(false)} />
              )}
            </div>
          </>
        )}

        {mobileProfileOpen && activeChat ? (
          <div className="fixed inset-0 z-50 bg-background md:hidden">
            {peekUserId ? (
              <UserPeekSidebar userId={peekUserId} onClose={() => setPeekUserId(null)} />
            ) : activeChatIsGroup ? (
              <GroupProfileSidebar
                chatId={activeChat}
                onClose={() => setShowProfile(false)}
                onLeftGroup={() => {
                  setShowProfile(false);
                  clearActiveChat();
                }}
              />
            ) : activeFriendId ? (
              <FriendProfileSidebar userId={activeFriendId} onClose={() => setShowProfile(false)} />
            ) : null}
          </div>
        ) : null}
      </div>
    </MainLayout>
  );
}
