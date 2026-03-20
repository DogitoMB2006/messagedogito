import React from 'react';
import { SideNav } from './SideNav';

export function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden relative selection:bg-primary/30">
      {/* Main Content Area */}
      {/* padding-right is for the desktop sidebar which is on the right */}
      {/* padding-bottom is for the mobile bottom bar */}
      <main className="flex-1 w-full h-full overflow-y-auto pb-16 md:pb-0 md:pr-20 transition-all duration-300">
        {children}
      </main>

      {/* Right Sidebar (Desktop) / Bottom Bar (Mobile) */}
      <SideNav />
    </div>
  );
}
