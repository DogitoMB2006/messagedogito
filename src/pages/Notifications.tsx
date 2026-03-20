import React, { useEffect, useState } from 'react';
import { MainLayout } from '../components/layout/MainLayout';
import { Bell, UserPlus, Heart, MessageSquare, Loader2 } from 'lucide-react';
import { Avatar } from '../components/ui/avatar';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function Notifications() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadRequests();

      // Subscribe to new requests
      const channel = supabase.channel('public:friend_requests')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${user.id}` }, (payload) => {
          // A new request arrived, reload them to get user details
          loadRequests();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const loadRequests = async () => {
    if (!user) return;
    setLoading(true);
    // Fetch pending requests where user is the receiver
    // Need to join with users table to get sender info
    const { data, error } = await supabase
      .from('friend_requests')
      .select('*, sender:users!friend_requests_sender_id_fkey(*)')
      .eq('receiver_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (!error && data) {
      const mapped = data.map((req: any) => ({
        id: req.id,
        senderId: req.sender_id,
        type: 'friend_request',
        user: req.sender.display_name,
        username: req.sender.username,
        avatarUrl: req.sender.avatar_url,
        time: new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        read: false
      }));
      setRequests(mapped);
    }
    setLoading(false);
  };

  const handleAction = async (id: string, senderId: string, action: 'accepted' | 'rejected') => {
    if (!user) return;
    // Optimistic UI updates could go here
    const { error } = await supabase
      .from('friend_requests')
      .update({ status: action })
      .eq('id', id);

    if (!error && action === 'accepted') {
      // Create single friendship record
      const id1 = user.id < senderId ? user.id : senderId;
      const id2 = user.id < senderId ? senderId : user.id;
      
      try {
        await supabase.from('friends').insert([
          { user_id: id1, friend_id: id2 }
        ]);
      } catch (e) {}
    }
    
    setRequests(prev => prev.filter(r => r.id !== id));
  };

  const getIcon = (type: string) => <UserPlus size={14} className="text-white" />;
  const getIconBg = (type: string) => 'bg-primary';

  return (
    <MainLayout>
      <div className="flex flex-col h-full max-w-3xl mx-auto p-4 md:p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Notifications</h1>
          <p className="text-muted-foreground mt-2">Manage your friend requests and alerts.</p>
        </div>

        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin text-primary" size={32} /></div>
        ) : requests.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-border/30 rounded-2xl bg-secondary/10">
            <Bell size={48} className="mx-auto mb-4 text-muted-foreground/50" />
            <p>You're all caught up!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((notif, idx) => (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                key={notif.id} 
                className={`flex items-start gap-4 p-4 rounded-2xl border ${notif.read ? 'bg-secondary/20 border-border/30' : 'bg-primary/5 border-primary/20 shadow-sm shadow-primary/5'} transition-all hover:bg-secondary/40`}
              >
                <div className="relative mt-1 shrink-0">
                  <Avatar fallback={notif.user} src={notif.avatarUrl} />
                  <div className={`absolute -bottom-1 -right-1 rounded-full p-1 shadow-sm border-2 border-background ${getIconBg(notif.type)}`}>
                    {getIcon(notif.type)}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-relaxed">
                    <span className="font-semibold text-foreground">{notif.user}</span>
                    <span className="text-muted-foreground"> sent you a friend request.</span>
                  </p>
                  <p className="text-xs text-primary/70 font-medium mt-1">{notif.time}</p>
                  
                  <div className="flex items-center gap-2 mt-4">
                    <button 
                      onClick={() => handleAction(notif.id, notif.senderId, 'accepted')}
                      className="px-4 py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors shadow-sm shadow-primary/30 active:scale-95"
                    >
                      Accept
                    </button>
                    <button 
                      onClick={() => handleAction(notif.id, notif.senderId, 'rejected')}
                      className="px-4 py-1.5 bg-secondary text-foreground text-sm font-semibold rounded-lg hover:bg-secondary/80 border border-border/50 transition-colors active:scale-95"
                    >
                      Decline
                    </button>
                  </div>
                </div>
                {!notif.read && (
                  <div className="w-2.5 h-2.5 bg-primary rounded-full mt-2 shrink-0 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
