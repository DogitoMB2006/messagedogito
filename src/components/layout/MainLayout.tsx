import React, { useState } from 'react';
import { SideNav } from './SideNav';
import { TitleBar } from './TitleBar';
import { UpdateModal } from '../ui/UpdateModal';

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [update, setUpdate] = useState<any>(null);

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden relative selection:bg-primary/30 border border-border/30 rounded-lg shadow-2xl">
      <TitleBar onUpdateAvailable={setUpdate} />
      
      <div className="flex flex-1 w-full overflow-hidden relative">
        {/* Main Content Area */}
        {/* padding-right is for the desktop sidebar which is on the right */}
        {/* padding-bottom is for the mobile bottom bar */}
        <main className="flex-1 w-full h-full overflow-y-auto pb-16 md:pb-0 md:pr-20 transition-all duration-300">
          {children}
        </main>

        {/* Right Sidebar (Desktop) / Bottom Bar (Mobile) */}
        <SideNav />
      </div>

      {update && <UpdateModal update={update} onClose={() => setUpdate(null)} />}
    </div>
  );
}
