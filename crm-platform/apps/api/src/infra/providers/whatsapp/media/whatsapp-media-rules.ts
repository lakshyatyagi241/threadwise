import { createHash } from 'node:crypto';

/**
 * What WhatsApp Cloud accepts as media, as data: the size limits per kind, the mime types per kind, and the decisions that follow
 * (what an outbound file is sent as, whether an audio file goes as a voice note, whether an inbound file is too big). Pure functions,
 * so the tables are unit-tested without a network.
 *
 * Source: Meta's "Supported media types" for the Cloud API (audio, document, image, sticker, video) and its size limits. Nothing in
 * here was verified against a live account.
 */
export const WA_MEDIA_KINDS = ['image', 'video', 'audio', 'document', 'sticker'] as const;
export type WaMediaKind = (typeof WA_MEDIA_KINDS)[number];

const KIB = 1024;
const MIB = 1024 * KIB;

/** Meta's per-kind limit. A sticker is 100 KB when static and 500 KB when animated (`stickerLimit` tells them apart). */
export const WA_MAX_BYTES: Record<WaMediaKind, number> = {
  image: 5 * MIB,
  video: 16 * MIB,
  audio: 16 * MIB,
  document: 100 * MIB,
  sticker: 500 * KIB,
};
export const WA_STATIC_STICKER_MAX_BYTES = 100 * KIB;

/** The mime types Meta documents per kind. Documents are listed for reference: any document type the store accepts is tried (see `classifyForUpload`). */
export const WA_MIMES: Record<WaMediaKind, readonly string[]> = {
  image: ['image/jpeg', 'image/png'],
  sticker: ['image/webp'],
  video: ['video/mp4', 'video/3gpp'],
  audio: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'],
  document: [
    'text/plain',
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};

/** Stable reasons an outbound file cannot go to WhatsApp as it is. They become the `code` of the failed message. */
export const WA_UPLOAD_REFUSAL = {
  UNSUPPORTED_TYPE: 'WA_MEDIA_UNSUPPORTED_TYPE',
  TRANSCODE_REQUIRED: 'WA_MEDIA_TRANSCODE_REQUIRED',
  TOO_LARGE: 'WA_MEDIA_TOO_LARGE',
  KIND_MISMATCH: 'WA_MEDIA_KIND_MISMATCH',
  NOT_FOUND: 'WA_MEDIA_NOT_FOUND',
  /** The provider has no upload endpoint and the store cannot make a temporary link to the file. */
  UPLOAD_UNSUPPORTED: 'WA_MEDIA_UPLOAD_UNSUPPORTED',
  /** The store's temporary link points at a private address (localhost, a LAN IP, a container name): the provider can never fetch it. */
  LINK_NOT_PUBLIC: 'WA_MEDIA_LINK_NOT_PUBLIC',
} as const;

/**
 * The host of a link a provider could never reach from the internet, or null when it may be public. A provider that takes files by link
 * (Interakt has no upload endpoint) fetches it from its own servers, so a link on localhost, a private network, a `.local` name or a
 * single-label name (a container such as `minio`) always fails there with "not a valid URI", far from the cause.
 */
export function privateLinkHost(link: string): string | null {
  let host: string;
  try {
    host = new URL(link).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return link;
  }
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return host;
  if (/\.(local|internal|lan|home|corp)$/.test(host)) return host;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const priv =
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
    return priv ? host : null;
  }
  if (/^(fc|fd|fe80)/.test(host) && host.includes(':')) return host;
  // A name with no dot is a container or LAN host, never a public one.
  return host.includes('.') || host.includes(':') ? null : host;
}
export type WaUploadRefusalCode = (typeof WA_UPLOAD_REFUSAL)[keyof typeof WA_UPLOAD_REFUSAL];

export class WaMediaRefusal extends Error {
  constructor(
    readonly code: WaUploadRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'WaMediaRefusal';
  }
}

/** The mime without parameters, lower-cased (`Audio/OGG; codecs=opus` -> `audio/ogg`). */
export const baseMime = (mime: string): string => mime.split(';')[0]!.trim().toLowerCase();

/** `audio/ogg` whose first page names the Opus codec: the only Ogg audio WhatsApp takes, and the one it shows as a voice note. */
export function isOggOpus(head: Buffer): boolean {
  if (head.length < 4 || head.subarray(0, 4).toString('ascii') !== 'OggS') return false;
  // The first Ogg page of an Opus stream holds the 8-byte identification header `OpusHead`, well inside the first 100 bytes.
  return head.subarray(0, Math.min(head.length, 256)).includes(Buffer.from('OpusHead', 'ascii'));
}

/** True for a WebP with the animation flag (VP8X chunk, bit 1 of the flags byte). A static sticker has the lower limit. */
export function isAnimatedWebp(head: Buffer): boolean {
  if (head.length < 21) return false;
  if (
    head.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    head.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return false;
  }
  return head.subarray(12, 16).toString('ascii') === 'VP8X' && (head[20]! & 0x02) !== 0;
}

export interface OutboundClassification {
  /** The kind the message is sent as (the key of the Graph payload). */
  kind: WaMediaKind;
  /** The mime the upload declares. */
  mime: string;
  maxBytes: number;
  /** An Ogg/Opus audio file: sent so WhatsApp shows a voice note. */
  voice: boolean;
}

/**
 * Decides what a stored file is sent as, or refuses it with a reason an agent can act on. Order: the file's own type must be one
 * WhatsApp carries for the kind the message says it is (a PDF cannot go as an image); audio containers WhatsApp does not take
 * (wav, webm) are refused with `WA_MEDIA_TRANSCODE_REQUIRED` because transcoding (ffmpeg) is deliberately not part of this release;
 * then the size limit of the kind.
 *
 * `head` is the first bytes of the file, used for the two things a mime string cannot say: Opus inside Ogg, and an animated sticker.
 * Documents are the one open kind: Meta lists a handful of types, but WhatsApp carries many more, so any document the platform's own
 * upload policy let in is sent and Meta has the final say (its refusal comes back as the failure reason).
 */
export function classifyForUpload(input: {
  mediaKind: WaMediaKind;
  mime: string;
  size: number;
  head: Buffer;
}): OutboundClassification {
  const mime = baseMime(input.mime);
  const refuse = (code: WaUploadRefusalCode, message: string): never => {
    throw new WaMediaRefusal(code, message);
  };

  const kind = input.mediaKind;
  let voice = false;

  switch (kind) {
    case 'image':
      if (mime === 'image/gif')
        refuse(
          WA_UPLOAD_REFUSAL.UNSUPPORTED_TYPE,
          'WhatsApp does not take GIF images. Send it as an MP4 video instead.',
        );
      if (mime === 'image/webp')
        refuse(
          WA_UPLOAD_REFUSAL.UNSUPPORTED_TYPE,
          'WhatsApp takes WebP only as a sticker, not as an image. Use JPEG or PNG.',
        );
      if (!WA_MIMES.image.includes(mime))
        refuse(
          WA_UPLOAD_REFUSAL.UNSUPPORTED_TYPE,
          `WhatsApp takes images as JPEG or PNG, not ${mime}.`,
        );
      break;
    case 'sticker':
      if (!WA_MIMES.sticker.includes(mime))
        refuse(WA_UPLOAD_REFUSAL.UNSUPPORTED_TYPE, `WhatsApp takes stickers as WebP, not ${mime}.`);
      break;
    case 'video':
      if (!WA_MIMES.video.includes(mime))
        refuse(
          WA_UPLOAD_REFUSAL.UNSUPPORTED_TYPE,
          `WhatsApp takes video as MP4 or 3GPP, not ${mime}. Converting video is not available yet.`,
        );
      break;
    case 'audio':
      if (mime === 'audio/ogg') {
        if (!isOggOpus(input.head))
          refuse(
            WA_UPLOAD_REFUSAL.TRANSCODE_REQUIRED,
            'WhatsApp takes Ogg audio only when it is Opus encoded. Converting audio is not available yet.',
          );
        voice = true;
      } else if (!WA_MIMES.audio.includes(mime)) {
        refuse(
          WA_UPLOAD_REFUSAL.TRANSCODE_REQUIRED,
          `WhatsApp takes audio as AAC, MP4, MP3, AMR or Ogg Opus, not ${mime}. Converting audio is not available yet.`,
        );
      }
      break;
    case 'document':
      // Open kind: see above. An image or audio file the agent chose to send as a document stays a document.
      break;
  }

  const maxBytes =
    kind === 'sticker' && !isAnimatedWebp(input.head)
      ? WA_STATIC_STICKER_MAX_BYTES
      : WA_MAX_BYTES[kind];
  if (input.size > maxBytes) {
    refuse(
      WA_UPLOAD_REFUSAL.TOO_LARGE,
      `The file is ${formatBytes(input.size)}; WhatsApp allows ${formatBytes(maxBytes)} for ${kind === 'audio' || kind === 'video' ? kind : `${kind}s`}.`,
    );
  }
  return { kind, mime, maxBytes, voice };
}

export function formatBytes(n: number): string {
  if (n >= MIB) return `${(n / MIB).toFixed(n % MIB === 0 ? 0 : 1)} MB`;
  if (n >= KIB) return `${Math.round(n / KIB)} KB`;
  return `${n} B`;
}

/**
 * The most bytes worth downloading for a file WhatsApp announced as `kind`. It is Meta's limit for the kind: a stream that goes past
 * it is cut at once instead of filling the disk. (The store applies its own per-type cap again once the real type is known.)
 */
export const inboundByteCap = (kind: WaMediaKind): number => WA_MAX_BYTES[kind];

/**
 * Meta announces a file's sha256 in the webhook and in the lookup answer. The encoding is not pinned down in the documentation (hex
 * and base64 both appear in the wild), so both are read. Returns the digest as lower-case hex, or null when the text is neither.
 */
export function sha256HexFrom(announced: string | undefined | null): string | null {
  const text = (announced ?? '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(text)) return text.toLowerCase();
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(text)) {
    const bytes = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (bytes.length === 32) return bytes.toString('hex');
  }
  return null;
}

export const sha256OfBuffer = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** A Meta media id goes into a url path, so it is held to the characters Meta uses (digits) plus a safe margin. */
export const isSafeMediaId = (id: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(id);
