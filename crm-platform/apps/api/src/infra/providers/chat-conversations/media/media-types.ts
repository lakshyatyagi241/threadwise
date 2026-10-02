/** The three groups the upload policy sorts files into, and the size limits are set per group. */
export type MediaKind = 'image' | 'media' | 'document';

const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('ascii');

export function kindOfMime(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return 'media';
  return 'document';
}

export interface SniffedType {
  mime: string;
  ext: string;
}

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
const OFFICE_ZIP: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};
const OFFICE_OLE: Record<string, string> = {
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
};

function looksLikeText(b: Buffer): boolean {
  const head = b.subarray(0, 1024);
  if (head.includes(0)) return false;
  return !/<\s*(html|script|svg|\?php|iframe|object|embed)/i.test(head.toString('utf8'));
}

/**
 * What a file really is, from its first bytes. A channel hands us bytes and a mime type that the sender chose; this is how a
 * WhatsApp "image" that is a script, or a PDF named `.png`, is told apart. `hint` (the declared mime) only decides between
 * formats that share a signature (an MP4 container is video or audio, a ZIP is a docx or a plain archive); it never overrides
 * what the bytes say. Null when the bytes are nothing we accept.
 */
export function sniffMediaType(buffer: Buffer, hint?: string): SniffedType | null {
  const b = buffer;
  const declared = hint?.split(';')[0]?.trim().toLowerCase();

  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (ascii(b, 0, 4) === 'GIF8') return { mime: 'image/gif', ext: 'gif' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP')
    return { mime: 'image/webp', ext: 'webp' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE')
    return { mime: 'audio/wav', ext: 'wav' };
  if (ascii(b, 0, 4) === '%PDF') return { mime: 'application/pdf', ext: 'pdf' };
  if (ascii(b, 0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(b, 0, 5) === '#!AMR') return { mime: 'audio/amr', ext: 'amr' };
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)) {
    return { mime: 'audio/mpeg', ext: 'mp3' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return declared?.startsWith('audio/')
      ? { mime: 'audio/webm', ext: 'webm' }
      : { mime: 'video/webm', ext: 'webm' };
  }
  if (ascii(b, 4, 8) === 'ftyp') {
    if (declared?.startsWith('audio/')) return { mime: 'audio/mp4', ext: 'm4a' };
    if (declared === 'video/3gpp') return { mime: 'video/3gpp', ext: '3gp' };
    return { mime: 'video/mp4', ext: 'mp4' };
  }
  if (b.subarray(0, 4).equals(OLE)) {
    const ext = declared ? OFFICE_OLE[declared] : undefined;
    return ext ? { mime: declared!, ext } : { mime: 'application/msword', ext: 'doc' };
  }
  if (b[0] === 0x50 && b[1] === 0x4b) {
    const ext = declared ? OFFICE_ZIP[declared] : undefined;
    return ext ? { mime: declared!, ext } : { mime: 'application/zip', ext: 'zip' };
  }
  if (looksLikeText(b) && b.length > 0) {
    return declared === 'text/csv'
      ? { mime: 'text/csv', ext: 'csv' }
      : { mime: 'text/plain', ext: 'txt' };
  }
  return null;
}

/** Types a browser may show inside the page. Everything else is offered as a download. */
const INLINE = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'video/3gpp',
  'application/pdf',
]);

export const isInlineMime = (mime: string): boolean => INLINE.has(mime);

const BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  amr: 'audio/amr',
  mp4: 'video/mp4',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
};

/** The type a stored key's extension stands for: the fallback when a link names no type. Anything unknown downloads as bytes. */
export function mimeForKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXT[ext] ?? 'application/octet-stream';
}

const OTHER_SERVABLE = [
  'image/bmp',
  'image/tiff',
  'video/quicktime',
  'video/x-matroska',
  'application/zip',
  'application/rtf',
  ...Object.keys(OFFICE_ZIP),
  ...Object.keys(OFFICE_OLE),
];
const SERVABLE = new Set([...Object.values(BY_EXT), ...OTHER_SERVABLE]);

/**
 * The Content-Type to send: the type the message row recorded when it is one of the types this store ever accepts, otherwise what
 * the key's extension says (which is bytes for anything unknown). A type that is not on the list (`text/html`, `image/svg+xml`,
 * script) is never echoed, so even a wrong row cannot make the browser treat a customer's file as a page.
 */
export function servableMime(declared: string | undefined, key: string): string {
  const mime = declared?.trim().toLowerCase();
  return mime && SERVABLE.has(mime) ? mime : mimeForKey(key);
}
