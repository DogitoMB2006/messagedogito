import { useState } from 'react';
import { Eye } from 'lucide-react';
import { cn } from '../../lib/utils';

const imgClass = 'w-full max-w-[520px] max-h-[340px] object-contain rounded-2xl';

type SpoilerChatImageProps = {
  src: string;
  className?: string;
  onOpenFullscreen?: (src: string) => void;
};

export function SpoilerChatImage({ src, className, onOpenFullscreen }: SpoilerChatImageProps) {
  const [revealed, setRevealed] = useState(false);

  if (revealed) {
    return (
      <img
        src={src}
        alt="Media message"
        className={cn(imgClass, onOpenFullscreen && 'cursor-zoom-in', 'spoiler-reveal', className)}
        draggable={false}
        onClick={() => onOpenFullscreen?.(src)}
        onKeyDown={(event) => {
          if (!onOpenFullscreen) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenFullscreen(src);
          }
        }}
        role={onOpenFullscreen ? 'button' : undefined}
        tabIndex={onOpenFullscreen ? 0 : undefined}
        aria-label={onOpenFullscreen ? 'View image full screen' : undefined}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className={cn(
        'group relative block w-full max-w-[520px] overflow-hidden rounded-2xl border border-border/50',
        'bg-secondary/40 text-left outline-none',
        'transition-all duration-200 hover:border-primary/40 hover:bg-secondary/55',
        'focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
      aria-label="Reveal spoiler image"
    >
      <img
        src={src}
        alt=""
        className={cn(
          imgClass,
          'blur-2xl scale-[1.08] opacity-85 pointer-events-none select-none',
          'transition-all duration-300 group-hover:blur-[18px] group-hover:opacity-95',
        )}
        draggable={false}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/55 px-4 backdrop-blur-[2px] transition-colors duration-200 group-hover:bg-background/50">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border/50 bg-secondary/60 shadow-md backdrop-blur-sm transition-all duration-200 group-hover:border-primary/40 group-hover:bg-primary/15 group-hover:scale-110">
          <Eye className="h-5 w-5 text-foreground/80 transition-colors duration-200 group-hover:text-primary" strokeWidth={1.75} aria-hidden />
        </div>
        <span className="text-sm font-semibold text-foreground/90">Click to reveal</span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Spoiler</span>
      </div>
    </button>
  );
}
