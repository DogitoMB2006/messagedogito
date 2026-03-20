import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

type UpdateStatusTone = 'info' | 'error';

interface UpdateStatus {
  tone: UpdateStatusTone;
  message: string;
}

interface UpdateContextType {
  pendingUpdate: Update | null;
  isUpdateModalOpen: boolean;
  isChecking: boolean;
  updateStatus: UpdateStatus | null;
  checkForUpdates: () => Promise<void>;
  closeUpdateModal: () => void;
  dismissUpdateStatus: () => void;
}

const UpdateContext = createContext<UpdateContextType | undefined>(undefined);

// Check every 30 minutes
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStatusTimeout = useCallback(() => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
  }, []);

  const dismissUpdateStatus = useCallback(() => {
    clearStatusTimeout();
    setUpdateStatus(null);
  }, [clearStatusTimeout]);

  const showUpdateStatus = useCallback((tone: UpdateStatusTone, message: string) => {
    clearStatusTimeout();
    setUpdateStatus({ tone, message });
    statusTimeoutRef.current = setTimeout(() => {
      setUpdateStatus(null);
      statusTimeoutRef.current = null;
    }, 6000);
  }, [clearStatusTimeout]);

  const getUpdateErrorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const normalizedMessage = message.toLowerCase();

    if (normalizedMessage.includes('404')) {
      return 'Update feed is missing from the latest GitHub release.';
    }

    if (normalizedMessage.includes('network') || normalizedMessage.includes('failed to fetch')) {
      return 'Could not reach GitHub to check for updates.';
    }

    return 'Update check failed. Please try again in a moment.';
  };

  const checkForUpdates = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setIsChecking(true);
        dismissUpdateStatus();
      }

      const update = await check({ timeout: 30000 });

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
      } else if (!silent) {
        showUpdateStatus('info', 'You already have the latest version installed.');
      }
    } catch (error) {
      if (!silent) {
        console.error('Update check failed', error);
        showUpdateStatus('error', getUpdateErrorMessage(error));
      }
    } finally {
      if (!silent) setIsChecking(false);
    }
  }, [dismissUpdateStatus, showUpdateStatus]);

  // Background polling
  useEffect(() => {
    // First check after 5 seconds of startup
    const initial = setTimeout(() => checkForUpdates(true), 5000);

    intervalRef.current = setInterval(() => checkForUpdates(true), CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initial);
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearStatusTimeout();
    };
  }, [checkForUpdates, clearStatusTimeout]);

  const closeUpdateModal = () => setIsUpdateModalOpen(false);

  return (
    <UpdateContext.Provider value={{
      pendingUpdate,
      isUpdateModalOpen,
      isChecking,
      updateStatus,
      checkForUpdates: () => checkForUpdates(false),
      closeUpdateModal,
      dismissUpdateStatus,
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
