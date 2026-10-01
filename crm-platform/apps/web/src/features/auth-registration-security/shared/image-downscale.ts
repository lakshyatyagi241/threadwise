/**
 * Client-side avatar preparation (TW-AUTH-026). Reference uploaded the original
 * and let the server reject anything over 2 MB. The API here accepts 1 MB, so
 * the browser shrinks the picture first: longest edge at most 512 px, then the
 * encoder quality (and if needed the size) is stepped down until it fits.
 */

export const AVATAR_MAX_EDGE = 512;
/** Under the API's 1 MiB cap with room for multipart overhead. */
export const AVATAR_MAX_BYTES = 900 * 1024;
/** Source files above this are refused before decoding (decoding a huge image can stall a phone). */
export const AVATAR_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export const QUALITY_STEPS = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5] as const;
/** After the last quality step the picture itself is shrunk by this factor. */
export const SHRINK_FACTOR = 0.8;
const MIN_EDGE = 96;

export function isAvatarType(type: string): boolean {
  return (AVATAR_TYPES as readonly string[]).includes(type);
}

/** Scales (width, height) down so the longest edge is at most `maxEdge`. Never upscales, never returns 0. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = AVATAR_MAX_EDGE,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface EncodeAttempt {
  width: number;
  height: number;
  quality: number;
}

/**
 * The sequence of encodes to try: all quality steps at the fitted size, then
 * the same steps again at 80% of it, and so on down to a floor. The first one
 * whose result is small enough wins.
 */
export function encodePlan(
  width: number,
  height: number,
  maxEdge: number = AVATAR_MAX_EDGE,
): EncodeAttempt[] {
  const plan: EncodeAttempt[] = [];
  let size = fitWithin(width, height, maxEdge);
  for (let round = 0; round < 4; round++) {
    for (const quality of QUALITY_STEPS) plan.push({ ...size, quality });
    const longest = Math.max(size.width, size.height);
    if (longest * SHRINK_FACTOR < MIN_EDGE) break;
    size = fitWithin(size.width, size.height, Math.floor(longest * SHRINK_FACTOR));
  }
  return plan;
}

export class ImageError extends Error {
  constructor(readonly reason: 'type' | 'too-large' | 'decode' | 'encode') {
    super(reason);
    this.name = 'ImageError';
  }
}

async function decode(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => undefined,
    };
  } catch {
    throw new ImageError('decode');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Returns a File ready to upload: re-encoded (WebP where the browser can, else
 * JPEG), at most 512 px on the long edge and under AVATAR_MAX_BYTES.
 */
export async function prepareAvatar(file: File): Promise<File> {
  if (!isAvatarType(file.type)) throw new ImageError('type');
  if (file.size > AVATAR_MAX_SOURCE_BYTES) throw new ImageError('too-large');

  const decoded = await decode(file);
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageError('encode');
    const mime = canvas.toDataURL('image/webp').startsWith('data:image/webp')
      ? 'image/webp'
      : 'image/jpeg';

    for (const attempt of encodePlan(decoded.width, decoded.height)) {
      canvas.width = attempt.width;
      canvas.height = attempt.height;
      if (mime === 'image/jpeg') {
        // JPEG has no alpha: paint white instead of letting transparency turn black.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, attempt.width, attempt.height);
      } else {
        ctx.clearRect(0, 0, attempt.width, attempt.height);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(decoded.source, 0, 0, attempt.width, attempt.height);
      const blob = await toBlob(canvas, mime, attempt.quality);
      if (blob && blob.size <= AVATAR_MAX_BYTES) {
        const ext = mime === 'image/webp' ? 'webp' : 'jpg';
        return new File([blob], `avatar.${ext}`, { type: mime });
      }
    }
    throw new ImageError('too-large');
  } finally {
    decoded.close();
  }
}
