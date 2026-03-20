import React from 'react';
import { NavLink } from 'react-router-dom';
import { MessageSquare, Bell, UserPlus, Home, Settings, LogOut } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';

export function SideNav() {
  const { signOut } = useAuth();
  const navItems = [
    { icon: Home, label: 'Home', path: '/' },
    { icon: Bell, label: 'Notifications', path: '/notifications' },
    { icon: UserPlus, label: 'Friends', path: '/friends' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  return (
    <nav className="fixed bottom-0 w-full h-16 border-t border-border/50 bg-background/80 backdrop-blur-xl md:right-0 md:top-10 md:h-[calc(100vh-2.5rem)] md:w-20 md:border-t-0 md:border-l flex flex-row md:flex-col items-center justify-around md:justify-between px-2 md:py-8 z-40">
      {/* App Logo / Top Icon (Desktop only) */}
      <div className="hidden md:flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-primary to-accent shadow-lg shadow-primary/20 text-white mb-8 group cursor-pointer">
        <MessageSquare size={24} className="transition-transform duration-500 group-hover:rotate-12 group-hover:scale-110" />
      </div>

      {/* Nav Links */}
      <div className="flex flex-row md:flex-col items-center justify-around w-full md:gap-6">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              cn(
                "relative flex items-center justify-center w-12 h-12 rounded-xl transition-all duration-300 group",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )
            }
            title={item.label}
          >
            {({ isActive }) => (
              <>
                <item.icon size={22} className={cn("transition-transform duration-300 group-hover:scale-110", isActive && "scale-110")} />
                {isActive && (
                  <motion.div
                    layoutId="nav-indicator-glow"
                    className="absolute inset-0 rounded-xl bg-primary/10"
                    initial={false}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                {isActive && (
                  <motion.div
                    layoutId="nav-indicator-border"
                    className="absolute -right-[1px] top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-l-full hidden md:block"
                    initial={false}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>

      {/* Bottom Actions (Desktop only) */}
      <div className="hidden md:flex flex-col items-center gap-4 mt-auto">
        <button onClick={signOut} className="flex items-center justify-center w-12 h-12 rounded-xl text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all duration-300 group" title="Logout">
          <LogOut size={22} className="group-hover:scale-110 group-hover:-translate-x-1 transition-all duration-300" />
        </button>
      </div>
    </nav>
  );
}
