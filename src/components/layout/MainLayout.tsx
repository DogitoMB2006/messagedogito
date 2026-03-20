import { SideNav } from './SideNav';
import { TitleBar } from './TitleBar';
import { UpdateModal } from '../ui/UpdateModal';
import { useUpdate } from '../../contexts/UpdateContext';
import { X } from 'lucide-react';

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { pendingUpdate, isUpdateModalOpen, closeUpdateModal, updateStatus, dismissUpdateStatus } = useUpdate();

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden relative selection:bg-primary/30 border border-border/30 rounded-lg shadow-2xl">
      <TitleBar />

      {updateStatus && (
        <div className={`mx-3 mt-3 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm shadow-sm ${
          updateStatus.tone === 'error'
            ? 'border-red-500/30 bg-red-500/10 text-red-600'
            : 'border-primary/20 bg-primary/10 text-foreground'
        }`}>
          <span>{updateStatus.message}</span>
          <button
            type="button"
            onClick={dismissUpdateStatus}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-current/20 bg-transparent transition-colors hover:bg-black/10"
            aria-label="Dismiss update status"
          >
            <X size={14} />
          </button>
        </div>
      )}
      
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
