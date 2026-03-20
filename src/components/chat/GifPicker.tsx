import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';

type GifPickerProps = {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
};

function pickGifThumbUrl(gif: any): string | null {
  // Use a higher-quality downsampled variant for crisp thumbnails.
  return gif?.images?.fixed_height_downsampled?.url || gif?.images?.fixed_height_small?.url || gif?.images?.fixed_height?.url || null;
}

function pickGifSendUrl(gif: any): string | null {
  // Prefer a reasonably sized animated URL.
  return gif?.images?.fixed_height?.url || gif?.images?.downsized_medium?.url || gif?.images?.original?.url || null;
}

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const apiKey = import.meta.env.VITE_GIPHY_API_KEY as string | undefined;
  const canSearch = useMemo(() => Boolean(apiKey && query.trim().length >= 2), [apiKey, query]);

  useEffect(() => {
    if (!canSearch) {
      setResults([]);
      setError(null);
      return;
    }

    const controller = new AbortController();

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const q = query.trim();
        const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey!)}&q=${encodeURIComponent(q)}&limit=24&offset=0&rating=pg-13&lang=en`;

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
  }, [canSearch, apiKey, query]);

  return (
    <div className="bg-background/95 backdrop-blur-xl border border-border/40 rounded-2xl shadow-2xl overflow-hidden">
      <div className="p-3 border-b border-border/30 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1">
          <Search size={16} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search GIFs..."
            className="w-full bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
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

      <div className="p-3">
        {error && (
          <div className="text-sm text-red-500/90 bg-red-500/10 border border-red-500/20 rounded-xl p-2 mb-2">{error}</div>
        )}

        {!apiKey && <div className="text-sm text-muted-foreground">Missing `VITE_GIPHY_API_KEY`.</div>}

        {loading && apiKey ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="animate-spin text-primary" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-sm text-muted-foreground">Type at least 2 characters to search GIFs.</div>
        ) : (
          <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto custom-scrollbar">
            {results.map((gif, idx) => {
              const thumbUrl = pickGifThumbUrl(gif);
              const sendUrl = pickGifSendUrl(gif);
              if (!thumbUrl || !sendUrl) return null;

              return (
                <button
                  type="button"
                  key={gif?.id || idx}
                  onClick={() => onSelect(sendUrl)}
                  className="relative rounded-xl overflow-hidden border border-border/30 hover:border-primary/40 transition-colors group bg-transparent"
                  aria-label="Select GIF"
                >
                  <div className="aspect-square w-full">
                    <img
                      src={thumbUrl}
                      alt="GIF result"
                      className="w-full h-full object-cover block"
                      draggable={false}
                    />
                  </div>
                  <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

