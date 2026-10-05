/**
 * What WhatsApp accepts as an attachment, so the composer can say so before a file is uploaded and a send is refused. The server
 * checks the real bytes; this is the early, friendly answer. Sizes are Meta's documented limits for the Cloud API.
 */

const MB = 1024 * 1024;

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document';
export const ATTACHMENT_KINDS: readonly AttachmentKind[] = ['image', 'video', 'audio', 'document'];

export interface MediaRule {
  maxBytes: number;
  mimes: readonly string[];
  extensions: readonly string[];
}

export const WHATSAPP_MEDIA_LIMITS: Record<AttachmentKind, MediaRule> = {
  image: {
    maxBytes: 5 * MB,
    mimes: ['image/jpeg', 'image/png'],
    extensions: ['jpg', 'jpeg', 'png'],
  },
  video: {
    maxBytes: 16 * MB,
    mimes: ['video/mp4', 'video/3gpp'],
    extensions: ['mp4', '3gp', '3gpp'],
  },
  audio: {
    maxBytes: 16 * MB,
    mimes: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'],
    extensions: ['aac', 'm4a', 'mp3', 'amr', 'ogg', 'opus'],
  },
  document: {
    maxBytes: 100 * MB,
    mimes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
    ],
    extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'],
  },
};

/** Channel kinds whose attachment rules are WhatsApp's. Others are left to the server. */
export const WHATSAPP_LIKE_KINDS: readonly string[] = ['whatsapp_cloud'];
export const hasWhatsappLimits = (channelKind: string): boolean =>
  WHATSAPP_LIKE_KINDS.includes(channelKind);

const extensionOf = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
};

/** Which kind of attachment a file is, from its type (or, when the browser gave none, its extension). Null when WhatsApp has no kind for it. */
export function classifyFile(file: { name: string; type: string }): AttachmentKind | null {
  const mime = file.type.toLowerCase().split(';')[0]!.trim();
  const ext = extensionOf(file.name);
  if (mime) {
    for (const kind of ATTACHMENT_KINDS) {
      if (WHATSAPP_MEDIA_LIMITS[kind].mimes.includes(mime)) return kind;
    }
  }
  if (mime === '' || mime === 'application/octet-stream') {
    for (const kind of ATTACHMENT_KINDS) {
      if (WHATSAPP_MEDIA_LIMITS[kind].extensions.includes(ext)) return kind;
    }
  }
  return null;
}

export type AttachmentCheck =
  | { ok: true; kind: AttachmentKind }
  | {
      ok: false;
      reason: 'empty' | 'unsupportedType' | 'kindNotAllowed' | 'tooLarge';
      kind?: AttachmentKind;
      maxBytes?: number;
    };

/** `allowed` is the channel's media capability (a subset of the four kinds). */
export function checkAttachment(
  file: { name: string; type: string; size: number },
  allowed: readonly string[],
): AttachmentCheck {
  if (file.size <= 0) return { ok: false, reason: 'empty' };
  const kind = classifyFile(file);
  if (!kind) return { ok: false, reason: 'unsupportedType' };
  if (!allowed.includes(kind)) return { ok: false, reason: 'kindNotAllowed', kind };
  const { maxBytes } = WHATSAPP_MEDIA_LIMITS[kind];
  if (file.size > maxBytes) return { ok: false, reason: 'tooLarge', kind, maxBytes };
  return { ok: true, kind };
}

/** The `accept` attribute of the file picker for the kinds the channel takes. */
export function acceptAttribute(allowed: readonly string[]): string {
  const parts: string[] = [];
  for (const kind of ATTACHMENT_KINDS) {
    if (!allowed.includes(kind)) continue;
    const rule = WHATSAPP_MEDIA_LIMITS[kind];
    parts.push(...rule.mimes, ...rule.extensions.map((e) => `.${e}`));
  }
  return parts.join(',');
}

/** The limits worth showing under the box: one entry per kind the channel takes, in megabytes. */
export function limitHints(allowed: readonly string[]): { kind: AttachmentKind; mb: number }[] {
  return ATTACHMENT_KINDS.filter((k) => allowed.includes(k)).map((kind) => ({
    kind,
    mb: WHATSAPP_MEDIA_LIMITS[kind].maxBytes / MB,
  }));
}
