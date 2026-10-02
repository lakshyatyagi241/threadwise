import { createHash } from 'node:crypto';

/** `user_avatars` refuses anything larger (CHECK on octet_length). */
export const AVATAR_MAX_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 5_000;

export interface DownloadedAvatar {
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  bytes: Buffer;
  /** Same shape as an uploaded avatar's etag: the first 16 hex characters of the content hash. */
  etag: string;
}

export interface AvatarDownloadOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Content type from the first bytes, never from the response header. */
export function sniffImage(bytes: Buffer): DownloadedAvatar['mime'] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  const head = bytes.subarray(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * A provider's profile picture is fetched from a CDN address the provider's own API returned. Even
 * so, only a public https host is followed: no IP literals, no single-label or internal names.
 */
export function isPublicHttpsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return false;
  if (!host.includes('.')) return false;
  return !/(^|\.)(localhost|local|internal|localdomain|invalid)$/.test(host);
}

/**
 * Downloads a social profile picture so it can be stored with the account (WD-AUTH-004 rule 4:
 * a returning identity gets an empty avatar filled in; WaDesk keeps the provider URL, the target
 * stores the image because avatars live in the database until the storage adapter lands).
 *
 * Best effort: any problem (not https, too large, not a real image, slow, refused) is `null`, and
 * the caller signs the person in without a picture. Nothing here throws.
 */
export async function downloadProviderAvatar(
  url: string | null | undefined,
  opts: AvatarDownloadOptions = {},
): Promise<DownloadedAvatar | null> {
  if (!url || !isPublicHttpsUrl(url)) return null;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      headers: { accept: 'image/*' },
      // The address came from the provider; a redirect to somewhere else is not followed.
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > AVATAR_MAX_BYTES) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > AVATAR_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    const mime = sniffImage(bytes);
    if (!mime) return null;
    return { mime, bytes, etag: createHash('sha1').update(bytes).digest('hex').slice(0, 16) };
  } catch {
    return null;
  }
}
