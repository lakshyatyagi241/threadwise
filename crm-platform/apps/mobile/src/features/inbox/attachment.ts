import type { InboxMediaKind } from '@crm/contracts';

/** A file the person chose to send, as the phone gave it: where it is, what it is called, what it is and how big. */
export interface PickedAttachment {
  uri: string;
  name: string;
  mime: string;
  /** `null` when the phone did not say; the server checks the real size anyway. */
  sizeBytes: number | null;
  kind: InboxMediaKind;
}

const MIB = 1024 * 1024;

/**
 * The most the API takes per kind of file (its own defaults, which are WhatsApp's limits: 5 MB pictures, 16 MB audio and video,
 * 100 MB documents). Checked before the upload so a person is told at once instead of after a long upload; the server still has
 * the last word (a workspace can set lower limits), and its refusal is shown too.
 */
export const ATTACHMENT_MAX_BYTES: Record<InboxMediaKind, number> = {
  image: 5 * MIB,
  video: 16 * MIB,
  audio: 16 * MIB,
  document: 100 * MIB,
};

export const attachmentKindOf = (mime: string): InboxMediaKind => {
  const type = mime.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'document';
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  '3gp': 'video/3gpp',
  pdf: 'application/pdf',
};

/** The type of a file when the phone did not give one: from the ending of its name or address. */
export function guessMime(nameOrUri: string): string {
  const ending = nameOrUri.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ending] ?? 'application/octet-stream';
}

const EXTENSION_BY_SUBTYPE: Record<string, string> = {
  jpeg: 'jpg',
  quicktime: 'mov',
  mpeg: 'mp3',
  'octet-stream': '',
};

/** The ending for a type: "jpg" for image/jpeg; nothing for a type with no short, ordinary ending (a long Office type, a plain binary). */
const extensionOf = (mime: string): string => {
  const subtype = mime.split('/')[1]?.split(';')[0]?.toLowerCase() ?? '';
  const ending = EXTENSION_BY_SUBTYPE[subtype] ?? subtype;
  return /^[a-z0-9]{1,5}$/.test(ending) ? ending : '';
};

/** A file name for something the phone did not name (a camera photo): "photo.jpg", "video.mp4", "file.pdf". */
export const fallbackName = (kind: InboxMediaKind, mime: string): string => {
  const stem = kind === 'document' ? 'file' : kind === 'image' ? 'photo' : kind;
  const ending = extensionOf(mime);
  return ending ? `${stem}.${ending}` : stem;
};

/**
 * The name with the ending the file really has. The picker can turn a HEIC photo into a JPEG and keep "IMG_1.HEIC" as its name; the
 * server and the person receiving it both read the ending, so it follows the type when the name's ending says a different one.
 */
const alignExtension = (name: string, mime: string): string => {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name;
  const named = MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()];
  const ending = extensionOf(mime);
  return named && named !== mime && ending ? `${name.slice(0, dot)}.${ending}` : name;
};

export const attachmentFrom = (input: {
  uri: string;
  name?: string | null;
  mime?: string | null;
  sizeBytes?: number | null;
}): PickedAttachment => {
  const mime = input.mime?.trim() || guessMime(input.name || input.uri);
  const kind = attachmentKindOf(mime);
  return {
    uri: input.uri,
    name: input.name?.trim() ? alignExtension(input.name.trim(), mime) : fallbackName(kind, mime),
    mime,
    sizeBytes: input.sizeBytes ?? null,
    kind,
  };
};

/** Why a file cannot be sent, found without asking the server; `null` when nothing is wrong that the phone can see. */
export function attachmentProblem(file: PickedAttachment): 'empty' | 'tooLarge' | null {
  if (file.sizeBytes === 0) return 'empty';
  if (file.sizeBytes !== null && file.sizeBytes > ATTACHMENT_MAX_BYTES[file.kind])
    return 'tooLarge';
  return null;
}
