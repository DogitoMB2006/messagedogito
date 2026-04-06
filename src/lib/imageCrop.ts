import type { Area } from 'react-easy-crop';
import { parseGIF, decompressFrames } from 'gifuct-js';
import type { ParsedFrame } from 'gifuct-js';
import { GIFEncoder, quantize, applyPalette, nearestColorIndex } from 'gifenc';

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (e) => reject(e));
    image.src = url;
  });
}

const MAX_OUTPUT = 1024;

/** Fallback chroma keys (RGB) — picked so they do not appear among opaque pixels. */
const CHROMA_CANDIDATES: readonly [number, number, number][] = [
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 0],
  [255, 0, 0],
  [0, 0, 255],
  [0, 255, 0],
];

function pickChromaKey(opaquePixelSamples: Iterable<Uint8ClampedArray>): [number, number, number] {
  const opaque = new Set<string>();
  for (const data of opaquePixelSamples) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] >= 128) {
        opaque.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
    }
  }
  for (const c of CHROMA_CANDIDATES) {
    if (!opaque.has(`${c[0]},${c[1]},${c[2]}`)) return c;
  }
  return CHROMA_CANDIDATES[0];
}

function isGifBuffer(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, 6);
  if (b.length < 6) return false;
  return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x39 || b[4] === 0x37) && b[5] === 0x61;
}

function cropCanvasToRgba(
  source: HTMLCanvasElement,
  pixelCrop: Area,
): { data: Uint8ClampedArray; width: number; height: number } {
  let { width, height } = pixelCrop;
  const scale = Math.min(1, MAX_OUTPUT / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Could not get canvas context');

  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';

  octx.drawImage(
    source,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outW,
    outH,
  );

  return octx.getImageData(0, 0, outW, outH);
}

type CroppedFrame = { data: Uint8ClampedArray; width: number; height: number; delay: number };

/** Pixels we replace with chroma key (matches threshold in the keying loop below). */
function frameHasTransparentPixelsForKey(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 128) return true;
  }
  return false;
}

/**
 * Decodes an animated (or static) GIF, crops each composited frame to `pixelCrop`, and re-encodes as GIF.
 * Uses per-frame rgb565 quantization (256 colors each) so a shared global palette cannot crush dark/skin tones
 * across long animations — that flattening caused near-black, posterized avatars.
 */
async function getCroppedGifBlob(arrayBuffer: ArrayBuffer, pixelCrop: Area): Promise<Blob> {
  const parsed = parseGIF(arrayBuffer);
  const frames = decompressFrames(parsed, true);
  if (frames.length === 0) throw new Error('No frames in GIF');

  const lw = parsed.lsd.width;
  const lh = parsed.lsd.height;
  const bgIdx = parsed.lsd.backgroundColorIndex;
  const gct = parsed.gct;
  const bgColor = gct[bgIdx] ?? [255, 255, 255];

  const canvas = document.createElement('canvas');
  canvas.width = lw;
  canvas.height = lh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get canvas context');

  ctx.fillStyle = `rgb(${bgColor[0]}, ${bgColor[1]}, ${bgColor[2]})`;
  ctx.fillRect(0, 0, lw, lh);

  const cropped: CroppedFrame[] = [];
  let prev: ParsedFrame | null = null;
  let prevRestoreBackup: ImageData | null = null;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    if (prev) {
      const d = prev.disposalType ?? 1;
      const { left, top, width, height } = prev.dims;
      if (d === 2) {
        ctx.fillStyle = `rgb(${bgColor[0]}, ${bgColor[1]}, ${bgColor[2]})`;
        ctx.fillRect(left, top, width, height);
      } else if (d === 3 && prevRestoreBackup) {
        ctx.putImageData(prevRestoreBackup, left, top);
        prevRestoreBackup = null;
      }
    }

    let currentBackup: ImageData | null = null;
    if ((frame.disposalType ?? 0) === 3) {
      currentBackup = ctx.getImageData(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    }

    const patchCopy = new Uint8ClampedArray(frame.patch);
    const patchData = new ImageData(patchCopy, frame.dims.width, frame.dims.height);
    ctx.putImageData(patchData, frame.dims.left, frame.dims.top);

    const { data, width: outW, height: outH } = cropCanvasToRgba(canvas, pixelCrop);
    cropped.push({
      data: new Uint8ClampedArray(data),
      width: outW,
      height: outH,
      delay: frame.delay ?? 100,
    });

    prevRestoreBackup = currentBackup;
    prev = frame;
  }

  let anyTransparent = false;
  for (const f of cropped) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) {
        anyTransparent = true;
        break;
      }
    }
    if (anyTransparent) break;
  }

  const key = anyTransparent ? pickChromaKey(cropped.map((f) => f.data)) : null;
  const working = cropped.map((f) => new Uint8ClampedArray(f.data));

  if (key) {
    const [kr, kg, kb] = key;
    for (const data of working) {
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) {
          data[i] = kr;
          data[i + 1] = kg;
          data[i + 2] = kb;
          data[i + 3] = 255;
        }
      }
    }
  }

  const gif = GIFEncoder();

  for (let i = 0; i < working.length; i++) {
    const data = working[i];
    const palette = quantize(data, 256, { format: 'rgb565' });
    const index = applyPalette(data, palette, 'rgb565');
    const { width: outW, height: outH, delay } = cropped[i];

    const thisFrameHadAlpha = frameHasTransparentPixelsForKey(cropped[i].data);
    const chromaPaletteIdx = key && thisFrameHadAlpha ? nearestColorIndex(palette, [key[0], key[1], key[2]]) : -1;
    const useTransparent = thisFrameHadAlpha && chromaPaletteIdx >= 0;

    if (i === 0) {
      gif.writeFrame(index, outW, outH, {
        palette,
        delay,
        repeat: 0,
        transparent: useTransparent,
        ...(useTransparent ? { transparentIndex: chromaPaletteIdx } : {}),
      });
    } else {
      gif.writeFrame(index, outW, outH, {
        palette,
        delay,
        transparent: useTransparent,
        ...(useTransparent ? { transparentIndex: chromaPaletteIdx } : {}),
      });
    }
  }

  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

/**
 * Rasters non-GIF images to a blob. For `sourceMimeType === 'image/gif'`, decodes the full animation,
 * crops each frame, and returns a GIF blob.
 */
export async function getCroppedImageBlob(
  imageSrc: string,
  pixelCrop: Area,
  mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality = 0.92,
  sourceMimeType?: string,
): Promise<Blob> {
  if (sourceMimeType === 'image/gif') {
    try {
      const buf = await fetch(imageSrc).then((r) => r.arrayBuffer());
      if (isGifBuffer(buf)) {
        return await getCroppedGifBlob(buf, pixelCrop);
      }
    } catch {
      /* fall through to raster path */
    }
  }

  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  let { width, height } = pixelCrop;
  const scale = Math.min(1, MAX_OUTPUT / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  canvas.width = outW;
  canvas.height = outH;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outW,
    outH,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to export image'));
      },
      mimeType,
      mimeType === 'image/jpeg' ? quality : undefined,
    );
  });
}
