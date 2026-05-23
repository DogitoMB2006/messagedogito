import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  loadDiamondEconomy,
  loadSenderDecorations,
  purchaseDecoration,
  recordAdWatchAndAwardDiamond,
  saveActiveDecoration,
} from '../lib/diamondData';

const MAX_ADS_PER_WINDOW = 3;
const AD_DURATION_MS = 5000; // 5-second simulated ad

interface DiamondContextValue {
  diamonds: number;
  ownedDecorations: string[];
  activeDecoration: string | null;
  adsWatchedInWindow: number;
  canWatchAd: boolean;
  watchingAd: boolean;
  adSecondsLeft: number;
  /** Load active decorations for multiple sender IDs (used by ChatWindow). */
  loadDecorationForSenders: (ids: string[]) => Promise<void>;
  senderDecorationById: Record<string, string | null>;
  watchAd: () => void;
  cancelAd: () => void;
  buyDecoration: (decorId: string, cost: number) => Promise<{ error: string | null }>;
  setActiveDecoration: (decorId: string | null) => Promise<void>;
  refresh: () => Promise<void>;
}

const DiamondContext = createContext<DiamondContextValue>({
  diamonds: 0,
  ownedDecorations: [],
  activeDecoration: null,
  adsWatchedInWindow: 0,
  canWatchAd: true,
  watchingAd: false,
  adSecondsLeft: 0,
  loadDecorationForSenders: async () => {},
  senderDecorationById: {},
  watchAd: () => {},
  cancelAd: () => {},
  buyDecoration: async () => ({ error: null }),
  setActiveDecoration: async () => {},
  refresh: async () => {},
});

export function DiamondProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [diamonds, setDiamonds] = useState(0);
  const [ownedDecorations, setOwnedDecorations] = useState<string[]>([]);
  const [activeDecoration, setActiveDecorationState] = useState<string | null>(null);
  const [adsWatchedInWindow, setAdsWatchedInWindow] = useState(0);
  const [watchingAd, setWatchingAd] = useState(false);
  const [adSecondsLeft, setAdSecondsLeft] = useState(0);
  const [senderDecorationById, setSenderDecorationById] = useState<Record<string, string | null>>({});

  const adTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const adCancelledRef = useRef(false);

  const canWatchAd = adsWatchedInWindow < MAX_ADS_PER_WINDOW;

  const refresh = useCallback(async () => {
    if (!user) return;
    const uid = user.id;
    const economy = await loadDiamondEconomy(uid);
    setDiamonds(economy.balance);
    setOwnedDecorations(economy.owned_ids);
    setActiveDecorationState(economy.active_id);
    setAdsWatchedInWindow(economy.adCount);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadDecorationForSenders = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const missing = ids.filter((id) => !(id in senderDecorationById));
      if (missing.length === 0) return;

      const map = await loadSenderDecorations(missing);
      setSenderDecorationById((prev) => ({ ...prev, ...map }));
    },
    [senderDecorationById],
  );

  const watchAd = useCallback(() => {
    if (!canWatchAd || watchingAd || !user) return;
    adCancelledRef.current = false;
    setWatchingAd(true);
    setAdSecondsLeft(Math.round(AD_DURATION_MS / 1000));

    let remaining = Math.round(AD_DURATION_MS / 1000);
    adTimerRef.current = setInterval(async () => {
      remaining -= 1;
      setAdSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(adTimerRef.current!);
        adTimerRef.current = null;
        if (adCancelledRef.current) {
          setWatchingAd(false);
          return;
        }
        const uid = user.id;
        const nextBalance = diamonds + 1;
        await recordAdWatchAndAwardDiamond(uid, nextBalance);
        setDiamonds(nextBalance);
        setAdsWatchedInWindow((c) => c + 1);
        setWatchingAd(false);
      }
    }, 1000);
  }, [canWatchAd, watchingAd, user, diamonds]);

  const cancelAd = useCallback(() => {
    adCancelledRef.current = true;
    if (adTimerRef.current) {
      clearInterval(adTimerRef.current);
      adTimerRef.current = null;
    }
    setWatchingAd(false);
    setAdSecondsLeft(0);
  }, []);

  const buyDecoration = useCallback(
    async (decorId: string, cost: number): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not logged in' };
      if (ownedDecorations.includes(decorId)) return { error: null };
      if (diamonds < cost) return { error: 'Not enough diamonds' };

      const uid = user.id;
      const newBalance = diamonds - cost;
      const newOwned = [...ownedDecorations, decorId];

      const result = await purchaseDecoration(uid, newBalance, newOwned, activeDecoration);
      if (result.error) return result;

      setDiamonds(newBalance);
      setOwnedDecorations(newOwned);
      return { error: null };
    },
    [user, diamonds, ownedDecorations, activeDecoration],
  );

  const setActiveDecoration = useCallback(
    async (decorId: string | null) => {
      if (!user) return;
      const uid = user.id;
      await saveActiveDecoration(uid, ownedDecorations, decorId);
      setActiveDecorationState(decorId);
      setSenderDecorationById((prev) => ({ ...prev, [uid]: decorId }));
    },
    [user, ownedDecorations],
  );

  return (
    <DiamondContext.Provider
      value={{
        diamonds,
        ownedDecorations,
        activeDecoration,
        adsWatchedInWindow,
        canWatchAd,
        watchingAd,
        adSecondsLeft,
        loadDecorationForSenders,
        senderDecorationById,
        watchAd,
        cancelAd,
        buyDecoration,
        setActiveDecoration,
        refresh,
      }}
    >
      {children}
    </DiamondContext.Provider>
  );
}

export function useDiamonds() {
  return useContext(DiamondContext);
}
