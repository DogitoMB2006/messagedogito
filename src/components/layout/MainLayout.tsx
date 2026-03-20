import { SideNav } from './SideNav';
import { TitleBar } from './TitleBar';
import { UpdateModal } from '../ui/UpdateModal';
import { useUpdate } from '../../contexts/UpdateContext';

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { pendingUpdate, isUpdateModalOpen, closeUpdateModal } = useUpdate();

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden relative selection:bg-primary/30 border border-border/30 rounded-lg shadow-2xl">
      <TitleBar />
      
      <div className="flex flex-1 w-full overflow-hidden relative">
        <main className="flex-1 w-full h-full overflow-y-auto pb-16 md:pb-0 md:pr-20 transition-all duration-300">
          {children}
        </main>
        <SideNav />
      </div>

      {isUpdateModalOpen && pendingUpdate && (
        <UpdateModal update={pendingUpdate} onClose={closeUpdateModal} />
      )}
    </div>
  );
}
