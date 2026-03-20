import { useState, useEffect } from 'react';
import { X, Calendar, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Avatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';

interface FriendProfileSidebarProps {
  userId: string;
  onClose: () => void;
}

export function FriendProfileSidebar({ userId, onClose }: FriendProfileSidebarProps) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userId) {
      const fetchFriend = async () => {
        setLoading(true);
        const { data } = await supabase.from('users').select('*').eq('id', userId).single();
        if (data) setProfile(data);
        setLoading(false);
      }
      fetchFriend();
    }
  }, [userId]);

  if (loading) {
    return (
      <motion.div 
        initial={{ x: 300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 300, opacity: 0 }}
        className="flex flex-col h-full bg-background/95 backdrop-blur-md justify-center items-center shadow-[-10px_0_30px_rgba(0,0,0,0.1)] text-primary"
      >
        <Loader2 className="animate-spin" size={32} />
      </motion.div>
    );
  }

  if (!profile) return null;

  return (
    <motion.div 
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 300, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="flex flex-col h-full bg-background/95 backdrop-blur-md overflow-y-auto custom-scrollbar shadow-[-10px_0_30px_rgba(0,0,0,0.1)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-background/40 backdrop-blur-md sticky top-0 z-20 border-b border-border/30">
        <h2 className="font-semibold text-foreground tracking-tight">Profile</h2>
        <button 
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-secondary text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X size={18} />
        </button>
      </div>

      {/* Banner & Avatar */}
      <div className="relative">
        <div className="h-32 w-full bg-secondary/80 overflow-hidden relative group">
          {profile.banner_url ? (
            <img src={profile.banner_url} alt="Banner" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
          ) : (
            <div className="w-full h-full bg-gradient-to-tr from-primary/20 to-accent/20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
        </div>
        
        <div className="px-5 absolute -bottom-10 left-0">
          <Avatar 
            size="xl" 
            fallback={profile.display_name} 
            src={profile.avatar_url} 
            className="border-4 border-background shadow-xl ring-1 ring-border/50 bg-secondary"
          />
        </div>
      </div>

      {/* Profile Info */}
      <div className="px-5 pt-14 pb-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">{profile.display_name}</h1>
          <p className="text-sm text-primary font-medium">@{profile.username}</p>
        </div>

        <div className="p-3 rounded-xl bg-secondary/20 border border-border/30">
          <p className="text-sm text-foreground/90 leading-relaxed">
            {profile.bio || "No bio yet."}
          </p>
        </div>

        {/* Details list */}
        <div className="space-y-3 px-1">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Calendar size={16} className="text-primary/70 shrink-0" />
            <span>Joined {new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 grid grid-cols-2 gap-3">
          <Button variant="outline" className="w-full bg-secondary/30 hover:bg-secondary/60 border-border/50 shadow-sm">
            Mute
          </Button>
          <Button variant="danger" className="w-full shadow-sm shadow-red-500/10">
            Block
          </Button>
        </div>

        {/* Media / Shared (mock) */}
        <div className="pt-6 border-t border-border/30">
          <h3 className="font-semibold text-sm mb-4 text-foreground tracking-tight">Shared Media</h3>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="aspect-square bg-secondary/30 rounded-xl flex items-center justify-center cursor-pointer hover:bg-secondary/80 border border-border/30 transition-all group overflow-hidden">
                <ImageIcon size={20} className="text-muted-foreground/50 group-hover:scale-110 group-hover:text-primary transition-all duration-300" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
