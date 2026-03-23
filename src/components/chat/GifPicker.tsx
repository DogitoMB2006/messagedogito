import { useEffect, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

type GifPickerProps = {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
  className?: string;
};

function pickGifThumbUrl(gif: any): string | null {
  // Use a higher-quality downsampled variant for crisp thumbnails.
  return gif?.images?.fixed_height_downsampled?.url || gif?.images?.fixed_height_small?.url || gif?.images?.fixed_height?.url || null;
}

function pickGifSendUrl(gif: any): string | null {
  // Prefer a reasonably sized animated URL.
  return gif?.images?.fixed_height?.url || gif?.images?.downsized_medium?.url || gif?.images?.original?.url || null;
}

export function GifPicker({ onSelect, onClose, className }: GifPickerProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const apiKey = import.meta.env.VITE_GIPHY_API_KEY as string | undefined;

  useEffect(() => {
    if (!apiKey) {
      setResults([]);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const q = query.trim();
    const key = apiKey;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const url =
          q.length >= 2
            ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&limit=24&offset=0&rating=pg-13&lang=en`
            : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(key)}&limit=24&rating=pg-13`;

        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Giphy request failed: ${res.status}`);

        const json = await res.json();
        setResults(Array.isArray(json?.data) ? json.data : []);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        setError(e?.message || 'Failed to load GIFs');
      } finally {
        setLoading(false);
      }
    }

    void run();

    return () => controller.abort();
  }, [apiKey, query]);

  return (
    <div
      className={cn(
        'flex max-h-full min-h-0 w-full flex-col overflow-hidden bg-background/95 backdrop-blur-xl border border-border/40 rounded-2xl shadow-2xl',
        className,
      )}
    >
      <div className="p-3 border-b border-border/30 flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Search size={16} className="text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search GIFs…"
            className="w-full min-w-0 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-secondary/60 transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Close GIF picker"
        >
          <X size={16} />
        </button>
      </div>

      {apiKey ? (
        <p className="px-3 pt-2 pb-0 text-[11px] text-muted-foreground shrink-0">
          {query.trim().length >= 2 ? 'Search results' : 'Trending — type to search'}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
        {error && (
          <div className="mb-2 shrink-0 rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-sm text-red-500/90">{error}</div>
        )}

        {!apiKey && <div className="shrink-0 text-sm text-muted-foreground">Missing `VITE_GIPHY_API_KEY`.</div>}

        {!apiKey ? null : loading ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <Loader2 className="animate-spin text-primary" />
          </div>
        ) : results.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No GIFs to show.</div>
        ) : (
          <div
            className={cn(
              'grid min-h-0 flex-1 auto-rows-max grid-cols-2 content-start gap-2.5 overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar sm:grid-cols-3',
            )}
          >
            {results.map((gif, idx) => {
              const thumbUrl = pickGifThumbUrl(gif);
              const sendUrl = pickGifSendUrl(gif);
              if (!thumbUrl || !sendUrl) return null;

              return (
                <button
                  type="button"
                  key={gif?.id || idx}
                  onClick={() => onSelect(sendUrl)}
                  className="relative block min-h-0 w-full overflow-hidden rounded-xl border border-border/30 bg-secondary/20 text-left transition-colors hover:border-primary/40 group"
                  aria-label="Select GIF"
                >
                  <div className="relative aspect-square w-full min-h-[96px]">
                    <img
                      src={thumbUrl}
                      alt=""
                      className="absolute inset-0 block size-full object-cover"
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

