import { useState } from 'react';
import { Eye } from 'lucide-react';
import { cn } from '../../lib/utils';

const imgClass = 'w-full max-w-[520px] max-h-[340px] object-contain rounded-2xl';

type SpoilerChatImageProps = {
  src: string;
  className?: string;
};

export function SpoilerChatImage({ src, className }: SpoilerChatImageProps) {
  const [revealed, setRevealed] = useState(false);

  if (revealed) {
    return (
      <img
        src={src}
        alt="Media message"
        className={cn(imgClass, className)}
        draggable={false}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className={cn(
        'relative block w-full max-w-[520px] overflow-hidden rounded-2xl border border-border/50 bg-secondary/40 text-left outline-none transition hover:bg-secondary/55 focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
      aria-label="Reveal spoiler image"
    >
      <img
        src={src}
        alt=""
        className={cn(imgClass, 'blur-2xl scale-[1.08] opacity-90 pointer-events-none select-none')}
        draggable={false}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-background/60 px-4 backdrop-blur-[2px]">
        <Eye className="h-7 w-7 text-foreground/90" strokeWidth={1.75} aria-hidden />
        <span className="text-sm font-medium text-foreground">Click to reveal</span>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Spoiler</span>
      </div>
    </button>
  );
}
