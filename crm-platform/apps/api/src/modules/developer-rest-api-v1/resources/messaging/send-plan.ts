import { V1_MEDIA_SEND_TYPES, type V1SendMessageInput, type V1SendType } from '@crm/contracts';

export type MediaSendType = (typeof V1_MEDIA_SEND_TYPES)[number];

export const isMediaType = (type: string): type is MediaSendType =>
  (V1_MEDIA_SEND_TYPES as readonly string[]).includes(type);

/** The file kind a stored MIME type stands for (WaDesk: `image/*`, `video/*`, `audio/*`, anything else a document). */
export function mediaTypeOfMime(mime: string): MediaSendType {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

/** The digits of what the caller wrote ("+91 98123-45678", "919812345678@s.whatsapp.net"). */
export const digitsOf = (raw: string): string => raw.replace(/\D+/g, '');

/**
 * A coordinate counts only when it is set and not zero: WaDesk tested them for "empty", and 0 is empty in PHP. Kept as it is, because
 * a client that sends `latitude: 0` today already gets a text send, and changing that would send them a pin instead.
 */
export const hasCoordinates = (i: Pick<V1SendMessageInput, 'latitude' | 'longitude'>): boolean =>
  Boolean(i.latitude) && Boolean(i.longitude);

/** The type a send is read as before the file is known: an explicit media type, or text that carries a file. */
export function wantsMedia(
  input: Pick<V1SendMessageInput, 'type' | 'media_url'>,
  hasFile: boolean,
): boolean {
  const type = input.type ?? 'text';
  return isMediaType(type) || (type === 'text' && (hasFile || Boolean(input.media_url)));
}

/** `media_required`: an explicit media type with neither a file nor a URL. */
export function missingMedia(
  input: Pick<V1SendMessageInput, 'type' | 'media_url'>,
  hasFile: boolean,
): boolean {
  const type = input.type ?? 'text';
  return isMediaType(type) && !hasFile && !input.media_url;
}

/**
 * The type a send reports back. Text that carries a file is read from the file (a URL alone reads as an image); an explicit type is
 * respected, and a pin made from coordinates still reports the type that was asked for (WaDesk answered it that way).
 */
export function reportedType(
  input: Pick<V1SendMessageInput, 'type' | 'media_url'>,
  file: { mime: string } | null,
): V1SendType {
  const type = input.type ?? 'text';
  if (type !== 'text') return type;
  if (file) return mediaTypeOfMime(file.mime);
  return input.media_url ? 'image' : 'text';
}
