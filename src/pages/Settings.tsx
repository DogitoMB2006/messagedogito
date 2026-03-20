import React, { useState } from 'react';
import { MainLayout } from '../components/layout/MainLayout';
import { ProfileEditModal } from '../components/chat/ProfileEditModal';
import { Button } from '../components/ui/button';
import { User, Bell, Shield, Moon, Monitor, Palette } from 'lucide-react';
import { Avatar } from '../components/ui/avatar';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';

export function Settings() {
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const { profile, signOut } = useAuth();

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <MainLayout>
      <div className="flex flex-col h-full max-w-3xl mx-auto p-4 md:p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Settings</h1>
          <p className="text-muted-foreground mt-2">Manage your account and preferences.</p>
        </div>

        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-6">
          {/* Profile Section */}
          <motion.section variants={itemVariants} className="p-6 rounded-3xl border border-border/40 bg-secondary/10 backdrop-blur-sm shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[80px]" />
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-2 relative z-10">
              <User size={20} className="text-primary" /> Profile Details
            </h2>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 relative z-10">
              <Avatar size="xl" src={profile?.avatar_url} fallback={profile?.display_name || 'U'} className="shrink-0 shadow-xl ring-2 ring-primary/20" />
              <div className="flex-1 space-y-1">
                <h3 className="text-2xl font-bold">{profile?.display_name || 'Loading...'}</h3>
                <p className="text-primary font-medium">@{profile?.username}</p>
                <p className="text-sm text-foreground/80 mt-2 max-w-sm">{profile?.bio || 'No bio yet.'}</p>
              </div>
              <Button onClick={() => setIsEditProfileOpen(true)} className="bg-primary/10 text-primary hover:bg-primary/20 border-0 shadow-none">
                Edit Profile
              </Button>
            </div>
          </motion.section>

          {/* App Preferences */}
          <motion.section variants={itemVariants} className="p-6 rounded-3xl border border-border/40 bg-secondary/10 backdrop-blur-sm shadow-sm">
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
              <Monitor size={20} className="text-primary" /> App Preferences
            </h2>
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 px-4 rounded-xl hover:bg-secondary/30 transition-colors gap-4">
                <div>
                  <h4 className="font-medium text-foreground flex items-center gap-2"><Palette size={16} className="text-muted-foreground" /> Theme</h4>
                  <p className="text-sm text-muted-foreground mt-0.5">Customize your app appearance</p>
                </div>
                <div className="flex items-center gap-1 p-1 bg-background border border-border/50 rounded-lg shadow-inner">
                  <button className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-foreground shadow-sm rounded-md text-sm font-medium transition-colors"><Moon size={14} /> Dark</button>
                  <button className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md text-sm font-medium transition-colors"><Monitor size={14} /> System</button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 px-4 rounded-xl hover:bg-secondary/30 transition-colors gap-4">
                <div>
                  <h4 className="font-medium text-foreground flex items-center gap-2"><Bell size={16} className="text-muted-foreground"/> Notifications</h4>
                  <p className="text-sm text-muted-foreground mt-0.5">Desktop alerts and sounds</p>
                </div>
                <div className="w-11 h-6 bg-primary rounded-full relative cursor-pointer shadow-inner">
                  <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm" />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 px-4 rounded-xl hover:bg-secondary/30 transition-colors gap-4">
                <div>
                  <h4 className="font-medium text-foreground flex items-center gap-2"><Shield size={16} className="text-muted-foreground"/> Privacy</h4>
                  <p className="text-sm text-muted-foreground mt-0.5">Manage visibility and status</p>
                </div>
                <Button variant="outline" size="sm" className="bg-background">Manage</Button>
              </div>
            </div>
          </motion.section>

          <Button variant="danger" className="w-full sm:w-auto" onClick={signOut}>
            Sign Out
          </Button>
        </motion.div>
      </div>

      <ProfileEditModal isOpen={isEditProfileOpen} onClose={() => setIsEditProfileOpen(false)} />
    </MainLayout>
  );
}
