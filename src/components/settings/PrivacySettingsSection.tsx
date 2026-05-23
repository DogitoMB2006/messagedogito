import { motion, type Variants } from 'framer-motion';
import { Bell, EyeOff, Loader2, Shield } from 'lucide-react';
import { usePresence, type ManualPresence } from '../../contexts/PresenceContext';
import { cn } from '../../lib/utils';
import { peerPresenceSubtextClass } from '../../lib/presenceDisplay';
import { isDesktopChromeAvailable } from '../../lib/runtime';
import { SettingsToggleRow } from './SettingsToggleRow';

const STATUS_OPTIONS: {
  value: ManualPresence;
  label: string;
  hint: string;
  dotClass: string;
}[] = [
  {
    value: 'online',
    label: 'Online',
    hint: 'Active when the window is focused',
    dotClass: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.55)]',
  },
  {
    value: 'idle',
    label: 'Idle',
    hint: 'Always show as away',
    dotClass: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.45)]',
  },
  {
    value: 'busy',
    label: 'Busy',
    hint: 'Silence desktop message alerts',
    dotClass: 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.45)]',
  },
];

type PrivacySettingsSectionProps = {
  variants?: Variants;
};

export function PrivacySettingsSection({ variants }: PrivacySettingsSectionProps) {
  const {
    manualMode,
    setManualMode,
    appearOffline,
    setAppearOffline,
    desktopNotificationsEnabled,
    setDesktopNotificationsEnabled,
    friendsSeeLabel,
    friendsSeeStatus,
    privacyReady,
    privacySaving,
  } = usePresence();

  const showDesktopHint = isDesktopChromeAvailable();
  const busy = !privacyReady || privacySaving;

  return (
    <motion.section
      variants={variants}
      className="p-6 rounded-3xl border border-border/40 bg-secondary/10 backdrop-blur-sm shadow-sm relative overflow-hidden"
    >
      <div className="absolute -top-12 -left-8 w-48 h-48 bg-primary/8 rounded-full blur-[72px]" />
      <div className="absolute bottom-0 right-0 w-56 h-56 bg-emerald-500/5 rounded-full blur-[80px]" />

      <div className="relative z-10 flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield size={20} className="text-primary" /> Privacy
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Control how others see you and when you get alerted.</p>
        </div>
        {busy ? (
          <Loader2 size={18} className="text-muted-foreground animate-spin shrink-0 mt-1" aria-hidden />
        ) : null}
      </div>

      <div className="relative z-10 space-y-2">
        <div className="py-3 px-4 rounded-xl bg-background/40 border border-border/30">
          <p className="text-sm font-medium text-foreground mb-3">Your status</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {STATUS_OPTIONS.map((opt) => {
              const selected = manualMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={busy}
                  onClick={() => void setManualMode(opt.value)}
                  className={cn(
                    'flex flex-col items-start gap-2 rounded-xl border px-3 py-3 text-left transition-all',
                    'outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    selected
                      ? 'border-primary/50 bg-primary/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                      : 'border-border/40 bg-secondary/20 hover:bg-secondary/40 hover:border-border/60',
                    busy && 'opacity-60 pointer-events-none',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('h-2.5 w-2.5 rounded-full', opt.dotClass)} aria-hidden />
                    <span className="text-sm font-semibold text-foreground">{opt.label}</span>
                  </span>
                  <span className="text-[11px] leading-snug text-muted-foreground">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <SettingsToggleRow
          title={
            <span className="flex items-center gap-2">
              <EyeOff size={16} className="text-muted-foreground" /> Appear offline
            </span>
          }
          description="Friends see you as offline even while you use the app."
          checked={appearOffline}
          disabled={busy}
          onCheckedChange={(next) => void setAppearOffline(next)}
        />

        <SettingsToggleRow
          title={
            <span className="flex items-center gap-2">
              <Bell size={16} className="text-muted-foreground" /> Message alerts
            </span>
          }
          description={
            showDesktopHint
              ? 'Desktop notifications for new messages. Busy status also silences alerts.'
              : 'Desktop notifications when using the installed app. Not available in the browser.'
          }
          checked={desktopNotificationsEnabled}
          disabled={busy}
          onCheckedChange={(next) => void setDesktopNotificationsEnabled(next)}
        />

        <p className="text-xs text-muted-foreground px-4 pt-1 pb-2">
          Friends see:{' '}
          <span className={cn('font-medium', peerPresenceSubtextClass(friendsSeeStatus))}>{friendsSeeLabel}</span>
        </p>
      </div>
    </motion.section>
  );
}
