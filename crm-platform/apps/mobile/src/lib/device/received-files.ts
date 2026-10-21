import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { log } from '@/lib/observability/logger';

/** The cache folder that holds the files a person opened from a conversation: nothing else lives there, so it can be emptied whole. */
const FOLDER = 'received';

/** A file stays this long after it was downloaded (a viewer app may still be reading it); older ones are removed at the next download. */
const KEEP_MS = 30 * 60_000;

/** Android's FLAG_GRANT_READ_URI_PERMISSION: lets the viewer app read the one file it is handed, and nothing else. */
const GRANT_READ = 1;

/** How long Android is given to say "no app for this" before the file is taken as opened: the call itself only ends when the viewer closes. */
const VIEWER_REPLY_MS = 1500;

/** Android allows 255 bytes in a file name; this leaves room for the folder-safety changes below. */
const MAX_NAME_BYTES = 120;

const folder = () => new Directory(Paths.cache, FOLDER);

/** Only the kind of failure goes to the log: an error's message can carry a file's address or name. */
const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'unknown');

/** The bytes a character takes in UTF-8 (a name's limit is in bytes, not characters). */
const utf8Bytes = (ch: string): number => {
  const cp = ch.codePointAt(0) ?? 0;
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
};
const byteLength = (text: string): number =>
  Array.from(text).reduce((sum, ch) => sum + utf8Bytes(ch), 0);

/** The start of `text` that fits in `limit` bytes, never cutting a character in two. */
function takeBytes(text: string, limit: number): string {
  let used = 0;
  let out = '';
  for (const ch of text) {
    used += utf8Bytes(ch);
    if (used > limit) break;
    out += ch;
  }
  return out;
}

/**
 * A name that is safe to write to the phone: no folders, no control characters, none of the characters that break a file address
 * (`# ? %`) or a file system, not empty, and short enough in bytes. The name comes from the customer's phone, so it is treated as
 * untrusted ("../../x" must never leave the folder). A short ending (".pdf") is kept.
 */
export function safeFileName(name: string | null | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = [...base]
    .filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .replace(/[#?%<>:"|*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!clean) return 'file';
  if (byteLength(clean) <= MAX_NAME_BYTES) return clean;
  const dot = clean.lastIndexOf('.');
  const ending = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : '';
  const stem = takeBytes(
    clean.slice(0, ending ? dot : undefined),
    MAX_NAME_BYTES - byteLength(ending),
  );
  return `${stem || 'file'}${ending}`;
}

const RISKY_TYPES = new Set([
  'application/vnd.android.package-archive',
  'application/x-msdownload',
  'application/x-dosexec',
  'application/x-sh',
  'application/x-shellscript',
  'application/java-archive',
  'application/javascript',
  'text/javascript',
  'text/html',
  'application/xhtml+xml',
]);
const RISKY_ENDINGS = /\.(apk|apks|xapk|exe|msi|bat|cmd|com|scr|sh|jar|js|vbs|html?|xhtml|svg)$/i;

/**
 * Types a phone should never launch straight from a customer's message: an app package, a program, a script, a web page. They are
 * only offered through the share sheet (to save or send on), never opened by another app on one tap.
 */
export const isRiskyFile = (mime: string, name: string | null): boolean =>
  RISKY_TYPES.has(mime.split(';')[0]?.trim().toLowerCase() ?? '') || RISKY_ENDINGS.test(name ?? '');

/** Deletes every file opened so far. Called when a session ends and when the app starts, so a customer's document does not outlive its use. */
export function clearReceivedFiles(): void {
  try {
    const dir = folder();
    if (dir.exists) dir.delete();
  } catch (error) {
    log.warn('files.clear_failed', { error: errorName(error) });
  }
}

/** Removes the downloads that are older than `KEEP_MS`. A newer one may still be open in a viewer, so it is left alone. */
function clearStaleFiles(now = Date.now()): void {
  try {
    const dir = folder();
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      const stamp = Number(entry.name.split('-')[0]);
      if (!Number.isFinite(stamp) || now - stamp > KEEP_MS) entry.delete();
    }
  } catch (error) {
    log.warn('files.clear_stale_failed', { error: errorName(error) });
  }
}

/**
 * Downloads one file of a conversation into the app's private cache, in a folder of its own so two files opened close together never
 * touch each other. The address is the API's media link, made for the signed-in person, so the request carries their token as a
 * header (never in the address). Throws when the download does not succeed (any status outside 2xx is a failure), and leaves nothing
 * behind when it does.
 */
export async function downloadReceivedFile(input: {
  uri: string;
  token: string;
  name: string | null;
}): Promise<File> {
  clearStaleFiles();
  const dir = new Directory(folder(), `${Date.now()}-${Crypto.randomUUID().slice(0, 8)}`);
  dir.create({ intermediates: true, idempotent: true });
  try {
    return await File.downloadFileAsync(input.uri, new File(dir, safeFileName(input.name)), {
      headers: { Authorization: `Bearer ${input.token}` },
      idempotent: true,
    });
  } catch (error) {
    // A cut transfer can leave half a file: it is removed, not kept for the next open.
    try {
      dir.delete();
    } catch {
      /* already gone */
    }
    throw error;
  }
}

/** What happened when the person was offered the file. */
export type OpenResult = 'opened' | 'noApp';

/**
 * Hands a downloaded file to the phone. Android opens it in the viewer app for its type (the person can save from there); with no
 * viewer, for a type that must not be launched on a tap, or on iOS, the phone's own share sheet is shown (Save to Files, Open in…,
 * Share). `noApp` means the phone cannot offer the file at all.
 */
export async function openReceivedFile(
  file: File,
  mime: string,
  dialogTitle: string,
  name: string | null = null,
): Promise<OpenResult> {
  if (Platform.OS === 'android' && !isRiskyFile(mime, name)) {
    const attempt = (async () =>
      IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: await getContentUriAsync(file.uri),
        type: mime,
        flags: GRANT_READ,
      }))();
    // The call ends only when the viewer is closed, so waiting for it would keep the person's tile busy while they read. An answer
    // within a moment means "no app for this" (or a failure); silence means a viewer is on screen.
    const early = await Promise.race([
      attempt.then(
        () => 'done' as const,
        (error: unknown) => error,
      ),
      new Promise<'viewing'>((resolve) => setTimeout(() => resolve('viewing'), VIEWER_REPLY_MS)),
    ]);
    if (early === 'viewing' || early === 'done') {
      void attempt.catch(() => undefined);
      return 'opened';
    }
    // No app for this type: the share sheet is the way left to save or send it on.
    log.info('files.no_viewer', { error: errorName(early) });
  }
  if (!(await Sharing.isAvailableAsync())) return 'noApp';
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle });
  return 'opened';
}
