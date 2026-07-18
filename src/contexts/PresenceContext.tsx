import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import {
  PEER_PRESENCE_BROADCAST_EVENT,
  PEER_PRESENCE_REALTIME_CHANNEL,
  dispatchPeerPresenceBroadcast,
  type PeerPresencePayload,
} from '../lib/presenceBroadcastBridge';
import {
  registerPresenceOfflineBeforeSignOut,
  setDesktopNotificationsEnabled,
  setPresenceNotificationsSilenced,
  unregisterPresenceOfflineBeforeSignOut,
} from '../lib/presenceNotifyGate';
import type { PresenceStatus } from '../lib/presenceDisplay';
import { peerPresenceLabel } from '../lib/presenceDisplay';
import {
  fetchPrivacySettings,
  loadCachedPrivacy,
  migrateLocalPrivacyToBackend,
  updatePrivacySettings,
  PRIVACY_STORAGE_KEYS,
  type ManualPresence,
  type PrivacySettings,
} from '../lib/privacyPreferences';

export type { ManualPresence };

const HEARTBEAT_MS = 30_000;

function computeEffective(manual: ManualPresence, netOnline: boolean, inForeground: boolean): PresenceStatus {
  if (!netOnline) return 'offline';
  if (manual === 'busy') return 'busy';
  if (manual === 'idle') return 'idle';
  return inForeground ? 'online' : 'idle';
}

function applyPrivacyToState(
  settings: PrivacySettings,
  setters: {
    setManualModeState: (m: ManualPresence) => void;
    setAppearOffline: (v: boolean) => void;
    setDesktopNotifications: (v: boolean) => void;
  },
) {
  setters.setManualModeState(settings.presence_manual);
  setters.setAppearOffline(settings.privacy_appear_offline);
  setters.setDesktopNotifications(settings.privacy_desktop_notifications);
  setDesktopNotificationsEnabled(settings.privacy_desktop_notifications);
}

interface PresenceContextValue {
  manualMode: ManualPresence;
  setManualMode: (m: ManualPresence) => Promise<void>;
  appearOffline: boolean;
  setAppearOffline: (enabled: boolean) => Promise<void>;
  desktopNotificationsEnabled: boolean;
  setDesktopNotificationsEnabled: (enabled: boolean) => Promise<void>;
  effectiveStatus: PresenceStatus;
  /** What friends see in chat lists (accounts for appear-offline). */
  friendsSeeStatus: PresenceStatus;
  friendsSeeLabel: string;
  inForeground: boolean;
  privacyReady: boolean;
  privacySaving: boolean;
}

const PresenceContext = createContext<PresenceContextValue | undefined>(undefined);

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const presenceBroadcastChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const cached = loadCachedPrivacy();

  const [manualMode, setManualModeState] = useState<ManualPresence>(() => cached.presence_manual);
  const [appearOffline, setAppearOfflineState] = useState(() => cached.privacy_appear_offline);
  const [desktopNotificationsEnabled, setDesktopNotificationsState] = useState(
    () => cached.privacy_desktop_notifications,
  );
  const [privacyReady, setPrivacyReady] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [netOnline, setNetOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [visible, setVisible] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true,
  );
  const [docFocused, setDocFocused] = useState(() => (typeof document !== 'undefined' ? document.hasFocus() : true));
  const [tauriRuntime, setTauriRuntime] = useState(false);
  const [tauriFocused, setTauriFocused] = useState<boolean | null>(null);

  const appearOfflineRef = useRef(appearOffline);
  appearOfflineRef.current = appearOffline;

  const inForeground = useMemo(() => {
    if (!visible) return false;
    if (tauriRuntime) {
      if (tauriFocused === null) return visible;
      return tauriFocused;
    }
    return docFocused;
  }, [visible, docFocused, tauriFocused, tauriRuntime]);

  const effectiveStatus = useMemo(
    () => computeEffective(manualMode, netOnline, inForeground),
    [manualMode, netOnline, inForeground],
  );

  const friendsSeeStatus: PresenceStatus = appearOffline ? 'offline' : effectiveStatus;
  const friendsSeeLabel = peerPresenceLabel(friendsSeeStatus);

  const effectiveStatusRef = useRef(effectiveStatus);
  effectiveStatusRef.current = effectiveStatus;
  const friendsSeeStatusRef = useRef(friendsSeeStatus);
  friendsSeeStatusRef.current = friendsSeeStatus;

  useEffect(() => {
    setDesktopNotificationsEnabled(desktopNotificationsEnabled);
  }, [desktopNotificationsEnabled]);

  useEffect(() => {
    setPresenceNotificationsSilenced(Boolean(user?.id) && effectiveStatus === 'busy');
    return () => setPresenceNotificationsSilenced(false);
  }, [user?.id, effectiveStatus]);

  const pushPresence = useCallback(
    async (status: PresenceStatus) => {
      const uid = user?.id;
      if (!uid) return;
      const presence_updated_at = new Date().toISOString();
      const { error } = await supabase
        .from('users')
        .update({
          presence_status: status,
          presence_updated_at,
        })
        .eq('id', uid);
      if (error) {
        console.warn('presence push failed', error.message);
        return;
      }
      const payload: PeerPresencePayload = {
        userId: uid,
        presence_status: status,
        presence_updated_at,
      };
      const ch = presenceBroadcastChRef.current;
      if (ch) {
        void ch
          .send({
            type: 'broadcast',
            event: PEER_PRESENCE_BROADCAST_EVENT,
            payload,
          })
          .catch(() => {});
      }
    },
    [user?.id],
  );

  const publishPresence = useCallback(() => {
    const status = appearOfflineRef.current ? 'offline' : effectiveStatusRef.current;
    void pushPresence(status);
  }, [pushPresence]);

  const pushOfflineNow = useCallback(async () => {
    await pushPresence('offline');
  }, [pushPresence]);

  const persistPrivacy = useCallback(
    async (patch: Partial<PrivacySettings>) => {
      const uid = user?.id;
      if (!uid) return { error: new Error('Not signed in') };
      setPrivacySaving(true);
      const { data, error } = await updatePrivacySettings(uid, patch);
      setPrivacySaving(false);
      if (error) return { error };
      if (data) {
        applyPrivacyToState(data, {
          setManualModeState,
          setAppearOffline: setAppearOfflineState,
          setDesktopNotifications: setDesktopNotificationsState,
        });
        publishPresence();
      }
      return { error: null };
    },
    [user?.id, publishPresence],
  );

  const setManualMode = useCallback(
    async (m: ManualPresence) => {
      setManualModeState(m);
      await persistPrivacy({ presence_manual: m });
    },
    [persistPrivacy],
  );

  const setAppearOffline = useCallback(
    async (enabled: boolean) => {
      setAppearOfflineState(enabled);
      appearOfflineRef.current = enabled;
      publishPresence();
      await persistPrivacy({ privacy_appear_offline: enabled });
    },
    [persistPrivacy, publishPresence],
  );

  const setDesktopNotificationsEnabledHandler = useCallback(
    async (enabled: boolean) => {
      setDesktopNotificationsState(enabled);
      setDesktopNotificationsEnabled(enabled);
      if (enabled) {
        try {
          const { isPermissionGranted, requestPermission } = await import('../lib/notifications');
          let granted = await isPermissionGranted();
          if (!granted) {
            const permission = await requestPermission();
            granted = permission === 'granted';
          }
        } catch {
          /* browser / no Tauri */
        }
      }
      await persistPrivacy({ privacy_desktop_notifications: enabled });
    },
    [persistPrivacy],
  );

  useEffect(() => {
    registerPresenceOfflineBeforeSignOut(pushOfflineNow);
    return () => unregisterPresenceOfflineBeforeSignOut();
  }, [pushOfflineNow]);

  useEffect(() => {
    const uid = user?.id;
    if (!uid) {
      setPrivacyReady(false);
      return;
    }

    let cancelled = false;
    setPrivacyReady(false);

    void (async () => {
      await migrateLocalPrivacyToBackend(uid);
      const { data, error } = await fetchPrivacySettings(uid);
      if (cancelled) return;
      if (data) {
        applyPrivacyToState(data, {
          setManualModeState,
          setAppearOffline: setAppearOfflineState,
          setDesktopNotifications: setDesktopNotificationsState,
        });
        appearOfflineRef.current = data.privacy_appear_offline;
      } else if (error) {
        const fallback = loadCachedPrivacy();
        applyPrivacyToState(fallback, {
          setManualModeState,
          setAppearOffline: setAppearOfflineState,
          setDesktopNotifications: setDesktopNotificationsState,
        });
        appearOfflineRef.current = fallback.privacy_appear_offline;
      }
      setPrivacyReady(true);
    })();

    const ch = supabase
      .channel(`privacy:${uid}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${uid}` },
        (payload) => {
          const row = payload.new as Record<string, unknown> | null;
          if (!row) return;
          const manual = row.presence_manual;
          if (manual === 'online' || manual === 'idle' || manual === 'busy') {
            setManualModeState(manual);
          }
          if (typeof row.privacy_appear_offline === 'boolean') {
            setAppearOfflineState(row.privacy_appear_offline);
            appearOfflineRef.current = row.privacy_appear_offline;
            publishPresence();
          }
          if (typeof row.privacy_desktop_notifications === 'boolean') {
            setDesktopNotificationsState(row.privacy_desktop_notifications);
            setDesktopNotificationsEnabled(row.privacy_desktop_notifications);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [user?.id, publishPresence]);

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible');
    const onFocus = () => setDocFocused(true);
    const onBlur = () => setDocFocused(false);
    const onOnline = () => setNetOnline(true);
    const onOffline = () => setNetOnline(false);

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    onVis();

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === PRIVACY_STORAGE_KEYS.manual) {
        const v = e.newValue;
        if (v === 'online' || v === 'idle' || v === 'busy') setManualModeState(v);
      }
      if (e.key === PRIVACY_STORAGE_KEYS.appearOffline) {
        const next = e.newValue === 'true';
        setAppearOfflineState(next);
        appearOfflineRef.current = next;
        publishPresence();
      }
      if (e.key === PRIVACY_STORAGE_KEYS.desktopNotifications) {
        const next = e.newValue !== 'false';
        setDesktopNotificationsState(next);
        setDesktopNotificationsEnabled(next);
      }
    };
    window.addEventListener('storage', onStorage);

    let unlistenTauri: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const w = getCurrentWindow();
        setTauriRuntime(true);
        const focused = await w.isFocused();
        setTauriFocused(focused);
        unlistenTauri = await w.onFocusChanged(({ payload: next }) => {
          setTauriFocused(next);
        });
      } catch {
        setTauriRuntime(false);
        setTauriFocused(null);
      }
    })();

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('storage', onStorage);
      unlistenTauri?.();
    };
  }, [publishPresence]);

  useEffect(() => {
    if (!user?.id) {
      presenceBroadcastChRef.current = null;
      return;
    }
    const ch = supabase
      .channel(PEER_PRESENCE_REALTIME_CHANNEL, {
        config: { broadcast: { self: true } },
      })
      .on('broadcast', { event: PEER_PRESENCE_BROADCAST_EVENT }, ({ payload }) => {
        const raw = payload as Partial<PeerPresencePayload> | undefined;
        if (!raw?.userId || !raw?.presence_status || !raw?.presence_updated_at) return;
        dispatchPeerPresenceBroadcast(raw as PeerPresencePayload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          presenceBroadcastChRef.current = ch;
          publishPresence();
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          presenceBroadcastChRef.current = null;
        }
      });

    return () => {
      presenceBroadcastChRef.current = null;
      void supabase.removeChannel(ch);
    };
  }, [user?.id, publishPresence]);

  useEffect(() => {
    if (!user?.id) return;

    publishPresence();
    const id = window.setInterval(publishPresence, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [user?.id, effectiveStatus, appearOffline, publishPresence]);

  useEffect(() => {
    if (!user?.id) return;

    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('presence-set-offline', () => {
          void pushOfflineNow();
        });
      } catch {
        /* web dev */
      }
    })();

    return () => {
      unlisten?.();
    };
  }, [user?.id, pushOfflineNow]);

  const value = useMemo(
    () => ({
      manualMode,
      setManualMode,
      appearOffline,
      setAppearOffline,
      desktopNotificationsEnabled,
      setDesktopNotificationsEnabled: setDesktopNotificationsEnabledHandler,
      effectiveStatus,
      friendsSeeStatus,
      friendsSeeLabel,
      inForeground,
      privacyReady,
      privacySaving,
    }),
    [
      manualMode,
      setManualMode,
      appearOffline,
      setAppearOffline,
      desktopNotificationsEnabled,
      setDesktopNotificationsEnabledHandler,
      effectiveStatus,
      friendsSeeStatus,
      friendsSeeLabel,
      inForeground,
      privacyReady,
      privacySaving,
    ],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  const ctx = useContext(PresenceContext);
  if (ctx === undefined) {
    throw new Error('usePresence must be used within PresenceProvider');
  }
  return ctx;
}

export function usePresenceOptional(): PresenceContextValue | null {
  return useContext(PresenceContext) ?? null;
}
