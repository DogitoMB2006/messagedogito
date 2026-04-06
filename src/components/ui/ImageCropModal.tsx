import { useState, useCallback, useEffect, type ImgHTMLAttributes } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import { Modal } from './modal';
import { Button } from './button';
import { Loader2 } from 'lucide-react';
import { getCroppedImageBlob } from '../../lib/imageCrop';
import { cn } from '../../lib/utils';

export type ImageCropShape = 'round' | 'rect';

interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string;
  /** Original file MIME (e.g. from `File.type`) so animated GIFs stay GIF after crop. */
  sourceMimeType?: string;
  aspect: number;
  cropShape: ImageCropShape;
  title: string;
  description?: string;
  onClose: () => void;
  /** Called with the cropped image; caller should revoke `imageSrc` if it is an object URL. */
  onConfirm: (blob: Blob) => void | Promise<void>;
}

export function ImageCropModal({
  isOpen,
  imageSrc,
  sourceMimeType,
  aspect,
  cropShape,
  title,
  description,
  onClose,
  onConfirm,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setMediaReady(false);
    }
  }, [isOpen, imageSrc]);

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return;
    setBusy(true);
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels, 'image/jpeg', 0.92, sourceMimeType);
      await onConfirm(blob);
    } finally {
      setBusy(false);
    }
  };

  const gifDecoding: Pick<ImgHTMLAttributes<HTMLImageElement>, 'decoding'> | undefined =
    sourceMimeType === 'image/gif' ? { decoding: 'sync' } : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size="lg"
      rootClassName="z-[100]"
      className="max-w-lg"
      panelMotion="fade"
    >
      <div className="space-y-4">
        <div className="relative h-[min(55vh,360px)] w-full overflow-hidden rounded-xl bg-secondary/70">
          <div
            className={cn(
              'absolute inset-0 transition-opacity duration-200 ease-out',
              mediaReady ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
          >
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              cropShape={cropShape}
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              onMediaLoaded={() => setMediaReady(true)}
              mediaProps={{ ...gifDecoding, onError: () => setMediaReady(true) }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-12 shrink-0">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-primary h-2"
            />
          </div>
          {sourceMimeType === 'image/gif' ? (
            <p className="text-xs text-muted-foreground">Animated GIFs stay animated after cropping.</p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={busy || !croppedAreaPixels} className="min-w-[100px]">
            {busy ? <Loader2 className="animate-spin size-[18px]" /> : 'Confirm'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
