import type { TplAttachment } from './form-model';

const MB = 1024 * 1024;

/** WhatsApp's caps for a header sample (TW-TPL-009 rule 2). */
export const MEDIA_MAX_BYTES: Record<TplAttachment, number> = {
  image: 5 * MB,
  video: 16 * MB,
  document: 100 * MB,
};

export const MEDIA_ACCEPT: Record<TplAttachment, string> = {
  image: 'image/jpeg,image/png',
  video: 'video/mp4,video/3gpp',
  document: 'application/pdf',
};

export type MediaProblem = 'wrongType' | 'tooBig' | 'empty';

/** `null` when the file may be uploaded for this header kind. */
export function mediaProblem(
  kind: TplAttachment,
  file: { type: string; size: number },
): MediaProblem | null {
  if (file.size <= 0) return 'empty';
  if (!MEDIA_ACCEPT[kind].split(',').includes(file.type)) return 'wrongType';
  if (file.size > MEDIA_MAX_BYTES[kind]) return 'tooBig';
  return null;
}

export const megabytes = (bytes: number): string => (bytes / MB).toFixed(1);
