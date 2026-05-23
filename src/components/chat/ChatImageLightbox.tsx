import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

type ChatImageLightboxProps = {
  src: string | null;
  alt?: string;
  onClose: () => void;
};

export function ChatImageLightbox({ src, alt = 'Media message', onClose }: ChatImageLightboxProps) {
  useEffect(() => {
    if (!src) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [src, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {src ? (
        <motion.div
          key={src}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          className="fixed inset-0 z-[100] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/90 backdrop-blur-sm"
            onClick={onClose}
            aria-label="Close image preview"
          />

          <button
            type="button"
            onClick={onClose}
            className={cn(
              'absolute z-10 flex items-center justify-center rounded-full',
              'bg-black/55 text-white border border-white/15 shadow-lg',
              'hover:bg-black/70 active:scale-95 transition-transform',
              'outline-none focus-visible:ring-2 focus-visible:ring-white/80',
              'top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))]',
              'h-11 w-11 sm:h-10 sm:w-10',
            )}
            aria-label="Close"
          >
            <X size={22} strokeWidth={2} aria-hidden />
          </button>

          <motion.img
            src={src}
            alt={alt}
            draggable={false}
            className={cn(
              'relative z-[1] max-w-[min(100vw-1.5rem,1200px)] max-h-[min(100dvh-5rem,900px)]',
              'w-auto h-auto object-contain select-none',
              'px-3 sm:px-6',
              'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
              'pt-[max(3.25rem,env(safe-area-inset-top))]',
            )}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.22 }}
            onClick={(event) => event.stopPropagation()}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
