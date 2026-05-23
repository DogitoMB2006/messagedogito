import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type SettingsToggleRowProps = {
  title: ReactNode;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (next: boolean) => void;
};

export function SettingsToggleRow({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: SettingsToggleRowProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 px-4 rounded-xl hover:bg-secondary/30 transition-colors gap-4">
      <div>
        <h4 className="font-medium text-foreground">{title}</h4>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'w-11 h-6 rounded-full relative transition-colors shadow-inner shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm',
            checked ? 'right-1' : 'left-1',
          )}
        />
      </button>
    </div>
  );
}
