import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
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
  setPresenceNotificationsSilenced,
  unregisterPresenceOfflineBeforeSignOut,
} from '../lib/presenceNotifyGate';
import type { PresenceStatus } from '../lib/presenceDisplay';

export type ManualPresence = 'online' | 'idle' | 'busy';

const STORAGE_KEY = 'dogito_presence_manual';
const HEARTBEAT_MS = 30_000;

function loadManual(): ManualPresence {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'online' || v === 'idle' || v === 'busy') return v;
  } catch {
    /* ignore */
  }
  return 'online';
}

function computeEffective(manual: ManualPresence, netOnline: boolean, inForeground: boolean): PresenceStatus {
  if (!netOnline) return 'offline';
  if (manual === 'busy') return 'busy';
  if (manual === 'idle') return 'idle';
  return inForeground ? 'online' : 'idle';
}

interface PresenceContextValue {
  manualMode: ManualPresence;
  setManualMode: (m: ManualPresence) => void;
  effectiveStatus: PresenceStatus;
  inForeground: boolean;
}

const PresenceContext = createContext<PresenceContextValue | undefined>(undefined);

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const presenceBroadcastChRef = useRef<RealtimeChannel | null>(null);

  const [manualMode, setManualModeState] = useState<ManualPresence>(() => loadManual());
  const [netOnline, setNetOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [visible, setVisible] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true,
  );
  const [docFocused, setDocFocused] = useState(() => (typeof document !== 'undefined' ? document.hasFocus() : true));
  /** True once Tauri window APIs work; WebView often lies about document.hasFocus(). */
  const [tauriRuntime, setTauriRuntime] = useState(false);
  const [tauriFocused, setTauriFocused] = useState<boolean | null>(null);

  const setManualMode = useCallback((m: ManualPresence) => {
    setManualModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  }, [user?.id]);

  const inForeground = useMemo(() => {
    if (!visible) return false;
    if (tauriRuntime) {
      // Native window focus is reliable; hasFocus() is often false in WebView2 while the app is active.
      if (tauriFocused === null) return visible;
      return tauriFocused;
    }
    return docFocused;
  }, [visible, docFocused, tauriFocused, tauriRuntime]);

  const effectiveStatus = useMemo(
    () => computeEffective(manualMode, netOnline, inForeground),
    [manualMode, netOnline, inForeground],
  );
  const effectiveStatusRef = useRef(effectiveStatus);
  effectiveStatusRef.current = effectiveStatus;

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

  const pushOfflineNow = useCallback(async () => {
    await pushPresence('offline');
  }, [pushPresence]);

  useEffect(() => {
    registerPresenceOfflineBeforeSignOut(pushOfflineNow);
    return () => unregisterPresenceOfflineBeforeSignOut();
  }, [pushOfflineNow]);

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
      if (e.key !== STORAGE_KEY) return;
      const v = e.newValue;
      if (v === 'online' || v === 'idle' || v === 'busy') {
        setManualModeState(v);
      }
    };
    window.addEventListener('storage', onStorage);

    let unlistenTauri: (() => void) | undefined;
    (async () => {
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
  }, []);

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
          void pushPresence(effectiveStatusRef.current);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          presenceBroadcastChRef.current = null;
        }
      });

    return () => {
      presenceBroadcastChRef.current = null;
      void supabase.removeChannel(ch);
    };
  }, [user?.id, pushPresence]);

  useEffect(() => {
    if (!user?.id) return;

    const run = () => {
      void pushPresence(effectiveStatus);
    };

    run();
    const id = window.setInterval(run, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [user?.id, effectiveStatus, pushPresence]);

  useEffect(() => {
    if (!user?.id) return;

    let unlisten: (() => void) | undefined;
    (async () => {
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
    () => ({ manualMode, setManualMode, effectiveStatus, inForeground }),
    [manualMode, setManualMode, effectiveStatus, inForeground],
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

/** For optional UI outside provider (e.g. safe no-op). */
export function usePresenceOptional(): PresenceContextValue | null {
  return useContext(PresenceContext) ?? null;
}
