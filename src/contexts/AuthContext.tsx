import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { isGroupLeaveMessage } from '../lib/groupMessageMarkers';
import { getActiveChatIdForNotifications } from '../lib/activeChatScope';
import { invalidateChatList } from '../lib/chatListInvalidate';
import { getHashPathname } from '../lib/hashRouterLocation';
import { splitLeadingReply, getNotificationMessageBody, isChatMediaUrl } from '../lib/replyMessageFormat';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

export interface UserProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  bio: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: SupabaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const senderCacheRef = useRef<Map<string, { name: string; avatarUrl: string | null }>>(new Map());
  const chatMembershipRef = useRef<Set<string>>(new Set());

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data) {
      setProfile(data as UserProfile);
    } else {
      setProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (user?.id) {
      await fetchProfile(user.id);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  useEffect(() => {
    let mounted = true;

    async function getInitialSession() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) console.error("Supabase getSession error:", error);

        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          if (session?.user) {
            void fetchProfile(session.user.id);
          }
        }
      } catch (err) {
        console.error("Auth Context error:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    getInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          void fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
      } catch (err) {
        console.error("Auth state change error:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Global push notifications listener
  useEffect(() => {
    if (!user) {
      chatMembershipRef.current = new Set();
      senderCacheRef.current.clear();
      return;
    }

    let permissionGranted = false;

    const setChatMembership = (chatIds: string[]) => {
      chatMembershipRef.current = new Set(chatIds.map(String));
    };

    const addChatMembership = (chatId: string) => {
      chatMembershipRef.current.add(String(chatId));
    };

    const removeChatMembership = (chatId: string) => {
      chatMembershipRef.current.delete(String(chatId));
    };

    const refreshChatMemberships = async () => {
      const { data, error } = await supabase
        .from('chat_participants')
        .select('chat_id')
        .eq('user_id', user.id);

      if (error) {
        return;
      }

      setChatMembership((data ?? []).map((row) => String(row.chat_id)));
    };

    const isRelevantChatForUser = async (chatId: string) => {
      const normalizedChatId = String(chatId);
      if (chatMembershipRef.current.has(normalizedChatId)) {
        return true;
      }

      const { data, error } = await supabase
        .from('chat_participants')
        .select('chat_id')
        .eq('chat_id', normalizedChatId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error || !data) {
        return false;
      }

      addChatMembership(normalizedChatId);
      return true;
    };

    const setupNotifications = async () => {
      try {
        // This fails safely if running in a regular web browser
        permissionGranted = await isPermissionGranted();
        if (!permissionGranted) {
          const permission = await requestPermission();
          permissionGranted = permission === 'granted';
        }
      } catch (err) {
        console.warn("Tauri notification API not available in browser.", err);
      }
    };
    
    setupNotifications();
    void refreshChatMemberships();
    
    const getMediaKind = (content: string): 'gif' | 'image' | 'text' => {
      const v = content.trim().toLowerCase();
      if (v.includes('.gif')) return 'gif';
      if (/\.(png|jpe?g|webp|svg|bmp|ico)(\?.*)?$/.test(v)) return 'image';
      return 'text';
    };

    const getSenderMeta = async (senderId: string) => {
      const cached = senderCacheRef.current.get(senderId);
      if (cached) return cached;

      const { data, error } = await supabase
        .from('users')
        .select('display_name, username, avatar_url')
        .eq('id', senderId)
        .maybeSingle();

      if (!error && data) {
        const name = data.display_name || data.username || 'Someone';
        const avatarUrl = data.avatar_url ?? null;
        const meta = { name, avatarUrl };
        senderCacheRef.current.set(senderId, meta);
        return meta;
      }

      const fallback = { name: 'Someone', avatarUrl: null };
      senderCacheRef.current.set(senderId, fallback);
      return fallback;
    };

    // Listen for incoming messages globally (INSERT for notifications; all events refresh chat list)
    const messagesChannel = supabase
      .channel('global:messages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async (payload) => {
        const payloadRow = payload.eventType === 'DELETE' ? payload.old : payload.new;
        const chatId = payloadRow?.chat_id ? String(payloadRow.chat_id) : null;
        if (!chatId) return;

        const isRelevantChat = await isRelevantChatForUser(chatId);
        if (!isRelevantChat) return;

        invalidateChatList();

        if (payload.eventType !== 'INSERT' || !payload.new) return;

        const row = payload.new as { sender_id?: string; chat_id?: string; content?: string };
        // Don't notify for our own messages
        if (row.sender_id === user.id) return;

        // Suppress while this thread is open (HashRouter: query lives in hash, not window.location.search)
        if (getActiveChatIdForNotifications() === String(row.chat_id)) {
          return;
        }

        try {
          if (!permissionGranted) return;

          const content = row.content;
          const senderId = row.sender_id as string;
          const chatId = row.chat_id as string;
          const sender = await getSenderMeta(senderId);

          const { data: chatInfo } = await supabase
            .from('chats')
            .select('name, is_group')
            .eq('id', chatId)
            .maybeSingle();
          const groupName = chatInfo?.is_group && chatInfo?.name ? String(chatInfo.name) : null;

          if (chatInfo?.is_group) {
            const { data: myPart } = await supabase
              .from('chat_participants')
              .select('notifications_muted')
              .eq('chat_id', chatId)
              .eq('user_id', user.id)
              .maybeSingle();
            if (myPart?.notifications_muted === true) return;
          }

          if (typeof content === 'string' && isGroupLeaveMessage(content)) {
            sendNotification({
              title: groupName || 'Group',
              body: `${sender.name} left the group`,
            });
            return;
          }

          const raw = typeof content === 'string' ? content : '';
          const split = splitLeadingReply(raw);
          const mediaProbe = split.isReply ? split.body.trim() : raw.trim();

          if (isChatMediaUrl(mediaProbe)) {
            const kind = getMediaKind(mediaProbe);
            const mediaBit = kind === 'gif' ? 'a GIF' : 'an image';
            const title = groupName
              ? `${groupName}: ${sender.name} sent ${mediaBit}`
              : kind === 'gif'
                ? `${sender.name} sent you a GIF`
                : `${sender.name} sent you an image`;
            sendNotification({
              title,
              body: 'Open chat to view.',
              attachments: sender.avatarUrl
                ? [
                    {
                      id: 'sender-avatar',
                      url: sender.avatarUrl,
                    },
                  ]
                : undefined,
            });
          } else {
            const title = groupName
              ? `${groupName}: ${sender.name}`
              : `${sender.name} sent you a message`;
            sendNotification({
              title,
              body: raw ? getNotificationMessageBody(raw) : '',
            });
          }
        } catch (e) {}
      }).subscribe();

    const participantsChannel = supabase
      .channel(`global:chat-participants:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_participants', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const payloadRow = payload.eventType === 'DELETE' ? payload.old : payload.new;
          const chatId = payloadRow?.chat_id ? String(payloadRow.chat_id) : null;
          if (!chatId) return;

          if (payload.eventType === 'DELETE') {
            removeChatMembership(chatId);
          } else {
            addChatMembership(chatId);
          }

          invalidateChatList();
        },
      )
      .subscribe();
      
    // Listen for incoming friend requests globally
    const requestsChannel = supabase.channel('global:requests')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${user.id}` }, () => {
         const isAppFocused = document.hasFocus();
         const isOnNotifRoute = getHashPathname() === '/notifications';

         if (isAppFocused && isOnNotifRoute) return;

         try {
           if (permissionGranted) {
             sendNotification({ title: 'New Friend Request! 🥳', body: 'Someone wants to connect with you.' });
           }
         } catch (e) {}
      }).subscribe();
      
    return () => {
       supabase.removeChannel(messagesChannel);
       supabase.removeChannel(participantsChannel);
       supabase.removeChannel(requestsChannel);
     };
  }, [user]);

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
