import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, Loader2, Plus, Sticker, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/utils';

type StickerRow = {
  id: string;
  owner_id: string;
  url: string;
  created_at: string;
};

type Tab = 'mine' | 'favorites';

type Props = {
  onSelect: (url: string) => void;
  onClose: () => void;
  className?: string;
};

const MAX_STICKERS = 5;

function getStickerObjectKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const objectMarker = '/objects/';
    const objectIndex = parsed.pathname.indexOf(objectMarker);
    if (objectIndex >= 0) {
      return decodeURIComponent(parsed.pathname.slice(objectIndex + objectMarker.length));
    }

    const legacyParts = parsed.pathname.split('/stickers/');
    return legacyParts.length > 1 ? legacyParts[1] : null;
  } catch {
    return null;
  }
}

export function StickerPicker({ onSelect, onClose, className }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('mine');

  // My stickers
  const [myStickers, setMyStickers] = useState<StickerRow[]>([]);
  const [myLoading, setMyLoading] = useState(false);

  // Favorites
  const [favStickers, setFavStickers] = useState<StickerRow[]>([]);
  const [favLoading, setFavLoading] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ─── Load my stickers ───────────────────────────────────────────────────────
  const loadMyStickers = useCallback(async () => {
    if (!user) return;
    setMyLoading(true);
    const { data, error } = await supabase
      .from('stickers')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true });
    if (!error && data) setMyStickers(data as StickerRow[]);
    setMyLoading(false);
  }, [user]);

  // ─── Load favorites ─────────────────────────────────────────────────────────
  const loadFavorites = useCallback(async () => {
    if (!user) return;
    setFavLoading(true);
    const { data, error } = await supabase
      .from('sticker_favorites')
      .select('sticker_id, stickers(*)')
      .eq('user_id', user.id);
    if (!error && data) {
      const stickers = data
        .map((row: any) => row.stickers as StickerRow)
        .filter(Boolean);
      setFavStickers(stickers);
      setFavoriteIds(new Set(stickers.map((s) => s.id)));
    }
    setFavLoading(false);
  }, [user]);

  useEffect(() => { void loadMyStickers(); }, [loadMyStickers]);
  useEffect(() => { void loadFavorites(); }, [loadFavorites]);

  // ─── Upload sticker ──────────────────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (myStickers.length >= MAX_STICKERS) {
      setUploadError(`Maximum ${MAX_STICKERS} stickers allowed.`);
      return;
    }

    setUploadError(null);
    setUploading(true);

    try {
      const ext = file.name.split('.').pop() ?? 'png';
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('stickers')
        .upload(path, file, { upsert: false });

      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage
        .from('stickers')
        .getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      const { error: dbErr } = await supabase
        .from('stickers')
        .insert({ owner_id: user.id, url: publicUrl });

      if (dbErr) throw dbErr;

      await loadMyStickers();
    } catch (err: any) {
      setUploadError(err?.message ?? 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  // ─── Delete my sticker ────────────────────────────────────────────────────────
  const handleDelete = async (sticker: StickerRow) => {
    if (!user || deletingId) return;
    setDeletingId(sticker.id);
    try {
      const key = getStickerObjectKey(sticker.url);
      if (key) {
        await supabase.storage.from('stickers').remove([key]);
      }
      await supabase.from('stickers').delete().eq('id', sticker.id).eq('owner_id', user.id);
      await loadMyStickers();
    } finally {
      setDeletingId(null);
    }
  };

  // ─── Toggle favorite ─────────────────────────────────────────────────────────
  const toggleFavorite = async (stickerId: string) => {
    if (!user) return;
    if (favoriteIds.has(stickerId)) {
      setFavoriteIds((prev) => { const s = new Set(prev); s.delete(stickerId); return s; });
      await supabase
        .from('sticker_favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('sticker_id', stickerId);
      setFavStickers((prev) => prev.filter((s) => s.id !== stickerId));
    } else {
      setFavoriteIds((prev) => new Set(prev).add(stickerId));
      await supabase
        .from('sticker_favorites')
        .insert({ user_id: user.id, sticker_id: stickerId });
      await loadFavorites();
    }
  };

  // ─── Render sticker grid ─────────────────────────────────────────────────────
  const renderGrid = (stickers: StickerRow[], showDelete = false) => {
    if (stickers.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
          <Sticker size={32} className="opacity-30" />
          <p className="text-sm">
            {showDelete ? 'No stickers yet. Upload one!' : 'No favorites yet.'}
          </p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-4 gap-2">
        {stickers.map((sticker) => {
          const isFav = favoriteIds.has(sticker.id);
          const isDeleting = deletingId === sticker.id;
          return (
            <div key={sticker.id} className="relative group">
              <button
                type="button"
                onClick={() => { onSelect(sticker.url); onClose(); }}
                disabled={isDeleting}
                className="w-full aspect-square rounded-xl overflow-hidden border border-border/30 hover:border-primary/50 transition-all bg-secondary/20 hover:bg-secondary/40 hover:scale-105 active:scale-95 relative"
                aria-label="Send sticker"
              >
                <img
                  src={sticker.url}
                  alt="Sticker"
                  className="w-full h-full object-contain p-1"
                  draggable={false}
                />
              </button>

              {/* Favorite button (shown on hover for favorites tab) */}
              {!showDelete && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void toggleFavorite(sticker.id); }}
                  className={`absolute top-1 right-1 h-6 w-6 rounded-full flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 shadow-sm ${
                    isFav
                      ? 'bg-red-500/80 text-white'
                      : 'bg-background/80 text-muted-foreground hover:text-red-400'
                  }`}
                  aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Heart size={11} fill={isFav ? 'currentColor' : 'none'} />
                </button>
              )}

              {/* Delete button (shown on hover in My Stickers tab) */}
              {showDelete && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handleDelete(sticker); }}
                  disabled={isDeleting}
                  className="absolute top-1 right-1 h-6 w-6 rounded-full flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 bg-red-500/80 text-white shadow-sm hover:bg-red-500"
                  aria-label="Delete sticker"
                >
                  {isDeleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                </button>
              )}

              {/* Heart button for my own stickers too */}
              {showDelete && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void toggleFavorite(sticker.id); }}
                  className={`absolute top-1 left-1 h-6 w-6 rounded-full flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 shadow-sm ${
                    isFav
                      ? 'bg-red-500/80 text-white'
                      : 'bg-background/80 text-muted-foreground hover:text-red-400'
                  }`}
                  aria-label={isFav ? 'In favorites' : 'Add to favorites'}
                >
                  <Heart size={11} fill={isFav ? 'currentColor' : 'none'} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className={cn(
        'bg-background/97 backdrop-blur-xl border border-border/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col min-h-0 max-h-full w-full max-w-[min(calc(100vw-1.5rem),320px)]',
        className,
      )}
    >
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-border/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sticker size={16} className="text-primary" />
          <span className="text-sm font-semibold text-foreground">Stickers</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-secondary/60 transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Close sticker picker"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/30">
        {(['mine', 'favorites'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === t
                ? 'text-primary border-b-2 border-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'mine' ? `Mis Stickers (${myStickers.length}/${MAX_STICKERS})` : '❤️ Favoritos'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-3 flex-1 min-h-0 max-h-[min(260px,38vh)] sm:max-h-[260px] overflow-y-auto custom-scrollbar">
        {tab === 'mine' && (
          <>
            {uploadError && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1.5 mb-2">
                {uploadError}
              </p>
            )}

            {myLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="animate-spin text-primary" size={20} />
              </div>
            ) : (
              renderGrid(myStickers, true)
            )}

            {/* Upload button */}
            {!myLoading && myStickers.length < MAX_STICKERS && (
              <div className="mt-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleUpload(e)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-border/50 text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-secondary/20 transition-all disabled:opacity-50"
                >
                  {uploading ? (
                    <><Loader2 size={13} className="animate-spin" /> Subiendo...</>
                  ) : (
                    <><Plus size={13} /> Subir sticker</>
                  )}
                </button>
              </div>
            )}

            {!myLoading && myStickers.length >= MAX_STICKERS && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Límite de {MAX_STICKERS} stickers alcanzado.
              </p>
            )}
          </>
        )}

        {tab === 'favorites' && (
          favLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin text-primary" size={20} />
            </div>
          ) : (
            renderGrid(favStickers, false)
          )
        )}
      </div>
    </div>
  );
}
