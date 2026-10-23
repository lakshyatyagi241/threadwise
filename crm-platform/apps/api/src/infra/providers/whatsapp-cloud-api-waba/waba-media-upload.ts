import type { WabaEnv } from '../../../config/domains/whatsapp-cloud-api-waba.env';
import { authOf, type WabaConnection } from './waba-admin.port';
import { WabaApiError, classifySendError } from './waba-errors';
import type { WabaHttp } from './waba-http';
import type { MediaUpload } from './waba-template.port';

/**
 * Waits before each retry of a throttled upload (Meta's code 4, "Application request limit reached", is transient: nothing was
 * stored, so the same request can simply be sent again). Two retries, then the throttle goes to the user.
 */
export const RATE_LIMIT_RETRY_WAITS_MS: readonly number[] = [1000, 3000];

/**
 * Runs `call`, and when Meta or the provider throttles it, waits and tries again. Any other failure is thrown at once, and so is a
 * throttle after the last wait.
 */
export async function retryOnRateLimit<T>(
  call: () => Promise<T>,
  waits: readonly number[] = RATE_LIMIT_RETRY_WAITS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (e) {
      const wait = waits[attempt];
      if (wait === undefined || !(e instanceof WabaApiError) || classifySendError(e) !== 'rate_limited')
        throw e;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/**
 * The handle Meta takes for a picture the app sends: a template header example or a profile picture. Interakt has its own
 * one-call media handle; a registry provider declares neither flow, so the upload is refused rather than sent to the wrong host.
 */
export async function uploadMediaHandle(
  http: WabaHttp,
  env: WabaEnv,
  conn: WabaConnection,
  media: MediaUpload,
  purpose: string,
): Promise<string> {
  if (conn.registry)
    throw new Error(`Uploading ${purpose} is not available through this WhatsApp provider.`);
  if (conn.provider === 'interakt') {
    // One multipart call, only on Interakt's older API version.
    const form = new FormData();
    form.set(
      'file',
      new Blob([media.bytes as unknown as ArrayBuffer], { type: media.mimeType }),
      media.fileName,
    );
    form.set('messaging_product', 'whatsapp');
    form.set('type', media.mimeType);
    const res = await retryOnRateLimit(() =>
      http.call<{ h?: string }>(authOf(conn), {
        method: 'POST',
        path: `/${conn.phoneNumberId}/media_handle`,
        form,
        apiVersion: env.INTERAKT_MEDIA_API_VERSION,
      }),
    );
    if (!res.h) throw new Error('Interakt returned no media handle');
    return res.h;
  }
  const appId = env.META_APP_ID;
  if (!appId) throw new Error(`META_APP_ID is needed to upload ${purpose}`);
  return resumableUpload(http, appId, conn.accessToken ?? '', media);
}

/**
 * Meta's resumable upload: a session under the platform app, the bytes sent into it, and the handle back. Meta checks the
 * number's own token, sent as `OAuth`.
 */
async function resumableUpload(
  http: WabaHttp,
  appId: string,
  token: string,
  media: MediaUpload,
): Promise<string> {
  const session = await http.graph<{ id?: string }>(null, {
    method: 'POST',
    path: `/${appId}/uploads`,
    query: {
      file_name: media.fileName,
      file_length: media.bytes.byteLength,
      file_type: media.mimeType,
    },
    headers: { authorization: `OAuth ${token}` },
  });
  if (!session.id) throw new Error('Meta returned no upload session');
  const done = await http.graph<{ h?: string }>(null, {
    method: 'POST',
    path: `/${session.id}`,
    headers: { authorization: `OAuth ${token}`, file_offset: '0' },
    body: media.bytes,
  });
  if (!done.h) throw new Error('Meta returned no media handle');
  return done.h;
}
