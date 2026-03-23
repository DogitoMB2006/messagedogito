import { createPortal } from 'react-dom';

type ComposerPickerSheetProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * Mobile-only style sheet: centers horizontally, respects safe area, blocks stray taps.
 */
export function ComposerPickerSheet({ open, onClose, children }: ComposerPickerSheetProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col justify-end pointer-events-auto"
      role="presentation"
      data-composer-picker-portal
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="relative z-10 mx-3 mb-[max(10px,env(safe-area-inset-bottom))] flex h-[min(58dvh,520px)] max-h-[min(90dvh,640px)] min-h-[280px] w-full max-w-[min(calc(100vw-1.5rem),420px)] flex-col self-center overflow-hidden rounded-2xl border border-border/50 bg-background/98 shadow-2xl backdrop-blur-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
