import { MediaFetchError } from '../whatsapp/media/media-fetch-error';
import { META_MEDIA_HOST_SUFFIXES, type HostPolicy } from '../whatsapp/media/media-url-guard';
import { safeRequest } from '../whatsapp/media/safe-http';

/** Messenger and Instagram files are small (a photo, a voice note); a larger one is refused rather than held in memory. */
export const SOCIAL_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const IDLE_TIMEOUT_MS = 15_000;

/** A file may be fetched from Meta's own media hosts only, over https, at a public address. */
const POLICY: HostPolicy = { hosts: META_MEDIA_HOST_SUFFIXES, loopbackHost: null };

export class SocialMediaDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocialMediaDownloadError';
  }
}

/**
 * Downloads a customer's attachment from the address Meta put in a webhook. That address is data from outside, so the media
 * pipeline's own guard applies (`safeRequest`): the host must be Meta's, the name must resolve to public addresses only (checked
 * inside the connection, so the address checked is the address used), and a redirect is never followed. The body is cut at `maxBytes`.
 */
export async function downloadSocialMedia(
  rawUrl: string,
  maxBytes = SOCIAL_MEDIA_MAX_BYTES,
): Promise<{ bytes: Buffer; mime: string }> {
  try {
    const res = await safeRequest({
      method: 'GET',
      url: rawUrl,
      policy: POLICY,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
    });
    if (res.status !== 200) {
      res.body.destroy();
      throw new SocialMediaDownloadError(`the host answered ${res.status}`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        res.body.destroy();
        throw new SocialMediaDownloadError('the file is too large');
      }
      chunks.push(chunk as Buffer);
    }
    return {
      bytes: Buffer.concat(chunks),
      mime: String(res.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!,
    };
  } catch (err) {
    if (err instanceof SocialMediaDownloadError) throw err;
    if (err instanceof MediaFetchError) throw new SocialMediaDownloadError(err.message);
    throw new SocialMediaDownloadError('the download was cut');
  }
}
