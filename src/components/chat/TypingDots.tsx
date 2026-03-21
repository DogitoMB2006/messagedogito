import { useEffect, useState } from 'react';

/** Cycles . → .. → ... for typing indicators. */
export function TypingDots({ className }: { className?: string }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setPhase((p) => (p + 1) % 3), 420);
    return () => window.clearInterval(t);
  }, []);
  const text = phase === 0 ? '.' : phase === 1 ? '..' : '...';
  return (
    <span className={className} aria-hidden>
      {text}
    </span>
  );
}
