import React from 'react';
import { cn } from '../../lib/utils';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const sizeClass = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-xl',
} as const;

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** Muted subtitle under the title */
  description?: string;
  children: React.ReactNode;
  className?: string;
  size?: keyof typeof sizeClass;
  /** Merged onto the fixed full-screen root (e.g. z-index when stacking modals) */
  rootClassName?: string;
  /**
   * `fade` = opacity only. Use for content that measures layout on open (e.g. react-easy-crop);
   * scale motion breaks cropper math and causes GIFs to flicker or show black frames.
   */
  panelMotion?: 'default' | 'fade';
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
  size = 'md',
  rootClassName,
  panelMotion = 'default',
}: ModalProps) {
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className={cn('fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6', rootClassName)}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-md"
            aria-hidden
            onClick={onClose}
          />
          <motion.div
            initial={
              panelMotion === 'fade'
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.96, y: 12 }
            }
            animate={panelMotion === 'fade' ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={
              panelMotion === 'fade'
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.96, y: 12 }
            }
            transition={
              panelMotion === 'fade'
                ? { duration: 0.2 }
                : { duration: 0.28, type: 'spring', damping: 26, stiffness: 320 }
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'modal-title' : undefined}
            className={cn(
              'relative z-50 w-full rounded-2xl border border-border/50',
              'bg-gradient-to-b from-secondary/25 via-background to-background',
              'shadow-[0_24px_64px_-16px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.04)_inset]',
              'overflow-hidden flex flex-col max-h-[min(90vh,720px)]',
              sizeClass[size],
              className,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/[0.08] via-transparent to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" />

            {title ? (
              <div className="relative shrink-0 px-6 pt-6 pb-4 border-b border-border/40">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1.5 pr-2">
                    <h2 id="modal-title" className="text-lg font-semibold tracking-tight text-foreground">
                      {title}
                    </h2>
                    {description ? (
                      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="shrink-0 rounded-xl p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="absolute top-4 right-4 z-10 rounded-xl p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}

            <div
              className={cn(
                'relative flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 py-5 text-foreground',
                !title && 'pt-14',
              )}
            >
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
