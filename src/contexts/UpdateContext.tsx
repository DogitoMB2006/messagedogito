import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { arePresenceNotificationsSilenced } from '../lib/presenceNotifyGate';

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

// Check frequently so newly published releases appear quickly.
const CHECK_INTERVAL_MS = 2 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 5000;
const STARTUP_FOLLOW_UP_DELAY_MS = 45000;
const FOREGROUND_RECHECK_COOLDOWN_MS = 45 * 1000;
const DISMISSED_UPDATE_VERSION_KEY = 'dogito.dismissedUpdateVersion';

function readDismissedUpdateVersion() {
  try {
    return localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY);
  } catch {
    return null;
  }
}

function writeDismissedUpdateVersion(version: string | null) {
  try {
    if (version) {
      localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, version);
    } else {
      localStorage.removeItem(DISMISSED_UPDATE_VERSION_KEY);
    }
  } catch {
    // Ignore localStorage failures.
  }
}

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedVersionRef = useRef<string | null>(readDismissedUpdateVersion());
  const autoPromptedVersionRef = useRef<string | null>(null);
  const notifiedVersionRef = useRef<string | null>(null);
  const lastSilentCheckAtRef = useRef(0);
  const isSilentCheckRunningRef = useRef(false);

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

  const setDismissedVersion = useCallback((version: string | null) => {
    dismissedVersionRef.current = version;
    writeDismissedUpdateVersion(version);
  }, []);

  const revealUpdateWindow = useCallback(async () => {
    const currentWindow = getCurrentWindow();

    try {
      if (await currentWindow.isMinimized()) {
        await currentWindow.unminimize();
      }
    } catch {
      // Ignore window state errors.
    }

    try {
      if (!(await currentWindow.isVisible())) {
        await currentWindow.show();
      }
    } catch {
      // Ignore window visibility errors.
    }

    try {
      await currentWindow.setFocus();
    } catch {
      // Ignore focus errors.
    }
  }, []);

  const notifyAboutUpdate = useCallback(async (update: Update) => {
    if (notifiedVersionRef.current === update.version) {
      return;
    }

    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === 'granted';
    }

    if (!granted) {
      return;
    }

    if (arePresenceNotificationsSilenced()) {
      return;
    }

    await sendNotification({
      title: 'DogitoChat update available',
      body: `Version ${update.version} is ready to install.`,
    });

    notifiedVersionRef.current = update.version;
  }, []);

  const checkForUpdates = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setIsChecking(true);
        dismissUpdateStatus();
      }

      const update = await check({ timeout: 30000 });

      if (update?.available) {
        const dismissedVersion = dismissedVersionRef.current;
        const shouldAutoOpen = !silent || (dismissedVersion !== update.version && autoPromptedVersionRef.current !== update.version);

        if (!silent) {
          setDismissedVersion(null);
        }

        if (shouldAutoOpen) {
          setPendingUpdate(update);
          setIsUpdateModalOpen(true);

          if (silent) {
            autoPromptedVersionRef.current = update.version;
          }
        }

        const currentWindow = getCurrentWindow();
        const [isVisible, isMinimized] = await Promise.all([
          currentWindow.isVisible().catch(() => true),
          currentWindow.isMinimized().catch(() => false),
        ]);

        const shouldRevealWindow = silent && shouldAutoOpen && (!isVisible || isMinimized);
        const shouldNotify = silent && shouldAutoOpen && (!document.hasFocus() || shouldRevealWindow);

        if (shouldNotify) {
          await notifyAboutUpdate(update);
        }

        if (shouldRevealWindow) {
          await revealUpdateWindow();
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
  }, [dismissUpdateStatus, notifyAboutUpdate, revealUpdateWindow, setDismissedVersion, showUpdateStatus]);

  const runSilentUpdateCheck = useCallback(async (force = false) => {
    const now = Date.now();

    if (isSilentCheckRunningRef.current) {
      return;
    }

    if (!force && now - lastSilentCheckAtRef.current < FOREGROUND_RECHECK_COOLDOWN_MS) {
      return;
    }

    isSilentCheckRunningRef.current = true;
    lastSilentCheckAtRef.current = now;

    try {
      await checkForUpdates(true);
    } finally {
      isSilentCheckRunningRef.current = false;
    }
  }, [checkForUpdates]);

  // Background polling
  useEffect(() => {
    const initial = setTimeout(() => {
      void runSilentUpdateCheck(true);
    }, STARTUP_CHECK_DELAY_MS);

    const followUp = setTimeout(() => {
      void runSilentUpdateCheck(true);
    }, STARTUP_FOLLOW_UP_DELAY_MS);

    intervalRef.current = setInterval(() => {
      void runSilentUpdateCheck(true);
    }, CHECK_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runSilentUpdateCheck();
      }
    };

    const handleWindowFocus = () => {
      void runSilentUpdateCheck();
    };

    const handleOnline = () => {
      void runSilentUpdateCheck(true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      clearTimeout(initial);
      clearTimeout(followUp);
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('online', handleOnline);
      clearStatusTimeout();
    };
  }, [clearStatusTimeout, runSilentUpdateCheck]);

  const closeUpdateModal = useCallback(() => {
    if (pendingUpdate?.version) {
      setDismissedVersion(pendingUpdate.version);
    }

    setIsUpdateModalOpen(false);
  }, [pendingUpdate, setDismissedVersion]);

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
