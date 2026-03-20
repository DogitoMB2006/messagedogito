import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

interface UpdateContextType {
  pendingUpdate: Update | null;
  isUpdateModalOpen: boolean;
  isChecking: boolean;
  checkForUpdates: () => Promise<void>;
  closeUpdateModal: () => void;
}

const UpdateContext = createContext<UpdateContextType | undefined>(undefined);

// Check every 30 minutes
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkForUpdates = useCallback(async (silent = false) => {
    try {
      if (!silent) setIsChecking(true);
      const update = await check();
      if (update?.available) {
        setPendingUpdate(update);
        setIsUpdateModalOpen(true);

        // Fire a desktop notification if window is not focused
        if (!document.hasFocus()) {
          let granted = await isPermissionGranted();
          if (!granted) {
            const permission = await requestPermission();
            granted = permission === 'granted';
          }
          if (granted) {
            sendNotification({
              title: '🔄 DogitoChat Update Available',
              body: `Version ${update.version} is ready to install. Click to update!`,
            });
          }
        }
      }
    } catch {
      // Silently ignore in background checks (404 = no update file yet, network error, etc.)
    } finally {
      if (!silent) setIsChecking(false);
    }
  }, []);

  // Background polling
  useEffect(() => {
    // First check after 5 seconds of startup
    const initial = setTimeout(() => checkForUpdates(true), 5000);

    intervalRef.current = setInterval(() => checkForUpdates(true), CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initial);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkForUpdates]);

  const closeUpdateModal = () => setIsUpdateModalOpen(false);

  return (
    <UpdateContext.Provider value={{
      pendingUpdate,
      isUpdateModalOpen,
      isChecking,
      checkForUpdates: () => checkForUpdates(false),
      closeUpdateModal,
    }}>
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate() {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error('useUpdate must be used within UpdateProvider');
  return ctx;
}

// Standalone auto-install helper used by UpdateModal
export async function downloadAndInstall(update: Update, onProgress: (p: number) => void) {
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0;
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      onProgress(total > 0 ? Math.round((downloaded / total) * 100) : 0);
    }
  });
  await relaunch();
}
