import { useState } from 'react';
import { X, Diamond, Play, Loader2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { DECORATIONS } from '../../lib/decorations';
import { useDiamonds } from '../../contexts/DiamondContext';

const MAX_ADS = 3;

export function DecorationShop({ onClose }: { onClose: () => void }) {
  const {
    diamonds,
    ownedDecorations,
    activeDecoration,
    adsWatchedInWindow,
    canWatchAd,
    watchingAd,
    adSecondsLeft,
    watchAd,
    cancelAd,
    buyDecoration,
    setActiveDecoration,
  } = useDiamonds();

  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [equippingId, setEquippingId] = useState<string | null>(null);

  const handleBuy = async (decorId: string, cost: number) => {
    setBuyError(null);
    setBuyingId(decorId);
    const { error } = await buyDecoration(decorId, cost);
    setBuyingId(null);
    if (error) setBuyError(error);
  };

  const handleEquip = async (decorId: string | null) => {
    const next = activeDecoration === decorId ? null : decorId;
    setEquippingId(decorId);
    await setActiveDecoration(next);
    setEquippingId(null);
  };

  const adsLeft = MAX_ADS - adsWatchedInWindow;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
        <span className="font-semibold text-foreground text-sm">Bubble Decorations</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-secondary/60 transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Close decoration shop"
        >
          <X size={16} />
        </button>
      </div>

      {/* Diamond balance + ad button */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 shrink-0 bg-blue-500/5">
        <div className="flex items-center gap-2">
          <Diamond size={16} className="text-blue-400 fill-blue-400/30" />
          <span className="text-blue-400 font-bold text-sm">{diamonds}</span>
          <span className="text-muted-foreground text-xs">diamonds</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">{adsLeft}/{MAX_ADS} ads left</span>
          <button
            type="button"
            onClick={watchAd}
            disabled={!canWatchAd || watchingAd}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
              canWatchAd && !watchingAd
                ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-md shadow-blue-500/30'
                : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50',
            )}
          >
            <Play size={11} className="fill-current" />
            +1 💎
          </button>
        </div>
      </div>

      {/* Ad watching progress */}
      <AnimatePresence>
        {watchingAd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 py-3 border-b border-border/30 bg-blue-500/10 shrink-0"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-blue-400 font-medium flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Watching ad… {adSecondsLeft}s
              </span>
              <button
                type="button"
                onClick={cancelAd}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
              >
                Cancel
              </button>
            </div>
            <div className="h-1.5 rounded-full bg-blue-500/20 overflow-hidden">
              <motion.div
                className="h-full bg-blue-500 rounded-full"
                initial={{ width: '100%' }}
                animate={{ width: `${(adSecondsLeft / 5) * 100}%` }}
                transition={{ duration: 1, ease: 'linear' }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      {buyError && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
          {buyError}
        </div>
      )}

      {/* Decorations grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        <div className="grid grid-cols-1 gap-3">
          {DECORATIONS.map((dec) => {
            const owned = ownedDecorations.includes(dec.id);
            const active = activeDecoration === dec.id;
            const buying = buyingId === dec.id;
            const equipping = equippingId === dec.id;
            const canAfford = diamonds >= dec.cost;

            return (
              <div
                key={dec.id}
                className={cn(
                  'flex items-center gap-4 p-3 rounded-2xl border transition-colors',
                  active
                    ? 'border-blue-500/50 bg-blue-500/8'
                    : 'border-border/40 bg-secondary/20 hover:bg-secondary/30',
                )}
              >
                {/* Preview bubble */}
                <div className="shrink-0 flex items-center justify-center w-16">
                  <div
                    className={cn(
                      'px-3 py-2 rounded-xl text-xs font-medium bg-primary text-primary-foreground',
                      dec.previewClass,
                    )}
                  >
                    Hello!
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-semibold text-foreground text-sm">{dec.name}</span>
                    {active && (
                      <span className="flex items-center gap-0.5 text-[10px] font-medium text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded-full">
                        <Check size={9} strokeWidth={3} /> Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{dec.description}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <Diamond size={11} className="text-blue-400 fill-blue-400/30" />
                    <span className="text-xs text-blue-400 font-semibold">{dec.cost}</span>
                  </div>
                </div>

                {/* Action */}
                <div className="shrink-0">
                  {owned ? (
                    <button
                      type="button"
                      onClick={() => void handleEquip(dec.id)}
                      disabled={equipping}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
                        active
                          ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30'
                          : 'bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20',
                      )}
                    >
                      {equipping ? <Loader2 size={12} className="animate-spin" /> : active ? 'Unequip' : 'Equip'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleBuy(dec.id, dec.cost)}
                      disabled={!canAfford || buying}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
                        canAfford
                          ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm shadow-blue-500/30'
                          : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50',
                      )}
                    >
                      {buying ? <Loader2 size={12} className="animate-spin" /> : 'Buy'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!canWatchAd && (
          <p className="text-center text-xs text-muted-foreground mt-4 px-4">
            Ad limit reached. Resets in 3 hours.
          </p>
        )}
      </div>
    </div>
  );
}
