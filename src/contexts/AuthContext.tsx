import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
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
    if (!user) return;

    let permissionGranted = false;
    
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
    
    const isMediaUrl = (value: unknown): value is string => {
      if (typeof value !== 'string' || !value.trim()) return false;
      const v = value.trim();
      try {
        const u = new URL(v);
        const path = u.pathname.toLowerCase();
        return /\.(gif|png|jpe?g|webp|svg|bmp|ico)$/.test(path);
      } catch {
        return /\.(gif|png|jpe?g|webp|svg|bmp|ico)(\?.*)?$/i.test(v);
      }
    };

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

    // Listen for incoming messages globally
    const messagesChannel = supabase.channel('global:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        // Don't notify for our own messages
        if (payload.new.sender_id === user.id) return;
        
        // Suppress notifications if the user is currently looking at this exact chat
        const isAppFocused = document.hasFocus();
        const isOnChatRoute = window.location.pathname === '/' || window.location.pathname === '/chats';
        const isReadingThisChat = isOnChatRoute && window.location.search.includes(payload.new.chat_id);

        // If app is focused and they are inside the specific chat, don't spam desktop notifications
        if (isAppFocused && isReadingThisChat) {
          return;
        }

        try {
          if (!permissionGranted) return;

          const content = payload.new.content;
          const senderId = payload.new.sender_id as string;
          const sender = await getSenderMeta(senderId);

          if (isMediaUrl(content)) {
            const kind = getMediaKind(content);
            const title = kind === 'gif' ? `${sender.name} sent you a GIF` : `${sender.name} sent you an image`;
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
            // Plain text message
            sendNotification({
              title: `${sender.name} sent you a message`,
              body: payload.new.content,
            });
          }
        } catch (e) {}
      }).subscribe();
      
    // Listen for incoming friend requests globally
    const requestsChannel = supabase.channel('global:requests')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${user.id}` }, () => {
         const isAppFocused = document.hasFocus();
         const isOnNotifRoute = window.location.pathname === '/notifications';
         
         if (isAppFocused && isOnNotifRoute) return;

         try {
           if (permissionGranted) {
             sendNotification({ title: 'New Friend Request! 🥳', body: 'Someone wants to connect with you.' });
           }
         } catch (e) {}
      }).subscribe();
      
    return () => {
       supabase.removeChannel(messagesChannel);
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
