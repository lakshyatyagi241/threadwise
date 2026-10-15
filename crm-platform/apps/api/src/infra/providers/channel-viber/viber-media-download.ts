import { MediaFetchError } from '../whatsapp/media/media-fetch-error';
import type { HostPolicy } from '../whatsapp/media/media-url-guard';
import { safeRequest } from '../whatsapp/media/safe-http';

/** A customer's file; Viber's own limit for a file a user sends is 50 MB, a picture or video far less, and a larger one is refused rather than held in memory. */
export const VIBER_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 15_000;

/** A file may be fetched from Viber's own media hosts only, over https, at a public address. */
export const VIBER_MEDIA_HOST_SUFFIXES: readonly string[] = ['.viber.com', '.viber.io'];
const POLICY: HostPolicy = { hosts: VIBER_MEDIA_HOST_SUFFIXES, loopbackHost: null };

export class ViberMediaDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViberMediaDownloadError';
  }
}

/**
 * Downloads a customer's attachment from the address Viber put in a webhook (a public link that lives about an hour). That address is
 * data from outside, so the media pipeline's own guard applies (`safeRequest`): the host must be Viber's, the name must resolve to
 * public addresses only (checked inside the connection), and a redirect is never followed. The body is cut at `maxBytes`.
 */
export async function downloadViberMedia(
  rawUrl: string,
  maxBytes = VIBER_MEDIA_MAX_BYTES,
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
      throw new ViberMediaDownloadError(`the host answered ${res.status}`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        res.body.destroy();
        throw new ViberMediaDownloadError('the file is too large');
      }
      chunks.push(chunk as Buffer);
    }
    return {
      bytes: Buffer.concat(chunks),
      mime: String(res.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!,
    };
  } catch (err) {
    if (err instanceof ViberMediaDownloadError) throw err;
    if (err instanceof MediaFetchError) throw new ViberMediaDownloadError(err.message);
    throw new ViberMediaDownloadError('the download was cut');
  }
}
