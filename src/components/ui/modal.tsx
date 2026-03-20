import React from 'react';
import { cn } from '../../lib/utils';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ isOpen, onClose, title, children, className }: ModalProps) {
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm" 
            onClick={onClose} 
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 10 }} 
            animate={{ opacity: 1, scale: 1, y: 0 }} 
            exit={{ opacity: 0, scale: 0.95, y: 10 }} 
            transition={{ duration: 0.3, type: 'spring', damping: 25, stiffness: 300 }}
            className={cn("relative z-50 w-full max-w-lg rounded-2xl border border-border/50 bg-background/95 backdrop-blur-md p-6 shadow-2xl overflow-hidden", className)}
          >
            {/* Glossy top edge highlight */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            
            {title && (
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-border/30">
                <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
                <button onClick={onClose} className="rounded-full p-1.5 hover:bg-secondary text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <X size={18} />
                </button>
              </div>
            )}
            {!title && (
              <button onClick={onClose} className="absolute top-4 right-4 rounded-full p-1.5 hover:bg-secondary text-muted-foreground transition-colors z-10 outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <X size={18} />
              </button>
            )}
            <div className="mt-2 text-sm text-foreground">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
