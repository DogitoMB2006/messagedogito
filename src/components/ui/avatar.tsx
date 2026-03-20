import React from 'react';
import { cn } from '../../lib/utils';
import { User } from 'lucide-react';

interface AvatarProps {
  src?: string | null;
  alt?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  fallback?: string;
}

export function Avatar({ src, alt, size = 'md', className, fallback }: AvatarProps) {
  const [error, setError] = React.useState(false);

  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-24 h-24',
  };

  return (
    <div className={cn('relative flex shrink-0 overflow-hidden rounded-full bg-secondary items-center justify-center border border-border/50', sizeClasses[size], className)}>
      {src && !error ? (
        <img
          src={src}
          alt={alt || 'Avatar'}
          className="aspect-square h-full w-full object-cover"
          onError={() => setError(true)}
        />
      ) : (
        <span className="text-muted-foreground font-semibold flex items-center justify-center h-full w-full">
          {fallback ? fallback.slice(0, 2).toUpperCase() : <User size={size === 'xl' ? 32 : size === 'sm' ? 16 : 20} className="text-muted-foreground/70" />}
        </span>
      )}
    </div>
  );
}
