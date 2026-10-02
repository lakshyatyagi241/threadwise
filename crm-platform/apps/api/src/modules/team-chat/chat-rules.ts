import { TCHAT_EDIT_WINDOW_MINUTES, TCHAT_MENTION_SOURCE } from '@crm/contracts';

/**
 * The pure rules of team chat: slugs, mention tokens, quote snippets, the edit window, direct-message keys, emoji and the
 * attachment allow-list. No database, no clock of its own, so each one has a unit test.
 */

/** `Support_Team` -> `support-team`. Underscores become dashes like WaDesk's Str::slug, so `dev_ops` and `dev-ops` collide. */
export function channelSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Every distinct user uuid named by an `@[Name](uuid)` token, in order of first appearance, lower-cased. */
export function extractMentionIds(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(new RegExp(TCHAT_MENTION_SOURCE, 'g'))) {
    seen.add(m[2]!.toLowerCase());
  }
  return [...seen];
}

/** The first 80 characters of a message for the reply quote, with mention tokens shown as the name they carry. */
export function quoteSnippet(body: string | null, max = 80): string {
  if (!body) return '';
  const plain = body.replace(new RegExp(TCHAT_MENTION_SOURCE, 'g'), '@$1');
  return [...plain].slice(0, max).join('');
}

/** A message can be edited by its author for 15 minutes after it was sent. */
export function withinEditWindow(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() <= TCHAT_EDIT_WINDOW_MINUTES * 60_000;
}

/** The slug of the direct-message channel between two users: the pair is unordered. */
export function directSlug(a: number, b: number): string {
  return `dm-${Math.min(a, b)}-${Math.max(a, b)}`;
}

/**
 * An emoji reaction is pictographic (or a flag, or a keycap) and holds no letters or digits of its own. WaDesk accepted any
 * string of up to 16 characters.
 */
const KEYCAP = /^[#*0-9]️?⃣$/u;
const EMOJI_GLUE = /️|‍|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}]/gu;
const PICTOGRAPHS = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})+$/u;
export function isEmoji(value: string): boolean {
  return KEYCAP.test(value) || PICTOGRAPHS.test(value.replace(EMOJI_GLUE, ''));
}

/** What a client is allowed to attach, by the type its bytes show (the declared type and the file name are not trusted). */
export interface SniffedFile {
  mime: string;
  isImage: boolean;
}

const startsWith = (buf: Buffer, bytes: number[], at = 0) =>
  bytes.every((b, i) => buf[at + i] === b);

const OFFICE_ZIP_NAMES: Array<[string, string]> = [
  ['word/', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xl/', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
];

/**
 * Identifies an allowed file from its leading bytes: PNG, JPEG, GIF, WebP, PDF, legacy Word/Excel (OLE), docx/xlsx (zip with the
 * right folder) and plain text. Anything else is refused (null). SVG is not an image here: it can carry script.
 */
export function sniffAttachment(buf: Buffer, fileName: string): SniffedFile | null {
  if (buf.length === 0) return null;
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mime: 'image/png', isImage: true };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', isImage: true };
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return { mime: 'image/gif', isImage: true };
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return { mime: 'image/webp', isImage: true };
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return { mime: 'application/pdf', isImage: false };
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.doc')) return { mime: 'application/msword', isImage: false };
    if (lower.endsWith('.xls')) return { mime: 'application/vnd.ms-excel', isImage: false };
    return null;
  }
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const text = buf.toString('latin1');
    const lower = fileName.toLowerCase();
    for (const [folder, mime] of OFFICE_ZIP_NAMES) {
      const ext = folder === 'word/' ? '.docx' : '.xlsx';
      if (lower.endsWith(ext) && text.includes(folder)) return { mime, isImage: false };
    }
    return null;
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.csv')) {
    // Text has no magic number: refuse anything with a NUL byte or markup that a browser could run.
    const head = buf.subarray(0, 4096);
    if (head.includes(0)) return null;
    return { mime: lower.endsWith('.csv') ? 'text/csv' : 'text/plain', isImage: false };
  }
  return null;
}

/** `LIKE` wildcards in a search needle are literals. */
export function escapeLike(needle: string): string {
  return needle.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The opaque `before` cursor of the history: the id of the oldest message returned. */
export function encodeMessageCursor(id: number): string {
  return Buffer.from(`m:${id}`, 'utf8').toString('base64url');
}

export function decodeMessageCursor(raw: string): number | null {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const m = /^m:(\d{1,15})$/.exec(text);
  return m ? Number(m[1]) : null;
}

/** A file name safe to put in a header and a column: no path, no control characters, at most 191 characters. */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  return (cleaned || 'file').slice(0, 191);
}
