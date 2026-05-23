import { useEffect, useRef, useState } from 'react';
import { Activity, Check } from 'lucide-react';
import { usePresence, type ManualPresence } from '../../contexts/PresenceContext';
import { cn } from '../../lib/utils';
import type { PresenceStatus } from '../../lib/presenceDisplay';

function selfIndicatorClass(s: PresenceStatus): string {
  if (s === 'online') return 'bg-emerald-500';
  if (s === 'idle') return 'bg-amber-400';
  if (s === 'busy') return 'bg-rose-500';
  return 'bg-muted-foreground';
}

const OPTIONS: { value: ManualPresence; label: string; hint: string }[] = [
  { value: 'online', label: 'Online', hint: 'Active when the window is focused' },
  { value: 'idle', label: 'Idle', hint: 'Always show as away' },
  { value: 'busy', label: 'Busy', hint: 'Silence all notifications' },
];

export function PresenceStatusControl() {
  const { manualMode, setManualMode, effectiveStatus } = usePresence();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        title="Your status"
        onClick={() => setOpen((o) => !o)}
        className="relative h-9 w-9 flex items-center justify-center rounded-full bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors border border-border/40"
      >
        <Activity size={18} />
        <span
          className={cn(
            'absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background',
            selfIndicatorClass(effectiveStatus),
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-[70] w-56 rounded-xl border border-border/50 bg-background/95 backdrop-blur-xl shadow-xl py-1 overflow-hidden">
          <p className="px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/40">
            Set status
          </p>
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                void setManualMode(opt.value);
                setOpen(false);
              }}
              className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-secondary/70 transition-colors"
            >
              <span className="mt-0.5 w-4 shrink-0 flex justify-center">
                {manualMode === opt.value ? <Check size={14} className="text-primary" /> : null}
              </span>
              <span>
                <span className="block text-sm font-medium text-foreground">{opt.label}</span>
                <span className="block text-[11px] text-muted-foreground leading-snug">{opt.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
