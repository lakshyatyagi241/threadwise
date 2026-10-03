import { Readable } from 'node:stream';
import { WabaApiError } from '../../whatsapp-cloud-api-waba/waba-errors';
import { WabaHttp } from '../../whatsapp-cloud-api-waba/waba-http';
import { downloadAuthApplies, downloadPolicy, type DnsResolver } from './media-url-guard';
import { MEDIA_FAILURE, MediaFetchError, redact, safeUrlForLog } from './media-fetch-error';
import {
  secretsIn,
  wabaAuthOf,
  type MediaAuthContext,
  type MediaProviderProfile,
} from './media-provider';
import { isSafeMediaId } from './whatsapp-media-rules';
import { readSmallBody, safeRequest } from './safe-http';
import type { WhatsappMediaConfig } from './whatsapp-media.config';

/**
 * The three calls the media pipeline makes:
 *
 *   lookup    `GET  {root}/{media-id}`              -> the temporary download url, mime, sha256, size       (through `WabaHttp`)
 *   upload    `POST {root}/{phone-number-id}/media` -> a media id for an outbound file                      (through `WabaHttp`)
 *   download  `GET  <that url>`                     -> the bytes, as a stream                               (here, see below)
 *
 * Lookup and upload are ordinary Cloud API calls, so they go through the platform's one WhatsApp client (`WabaHttp`: base address,
 * version, auth headers, timeout, error normalisation). The download is not an API call: its address comes out of the lookup's JSON (data
 * from outside), the body is a large binary that must be streamed into the store under a byte cap, and every hop must pass the SSRF guard.
 * `WabaHttp` reads whole JSON bodies, so the download keeps `safeRequest`; it takes its host list and its credentials from the same
 * profile (`WabaHttp`'s own configuration), places the headers only on requests to the provider's own host (and Meta's media hosts when
 * the profile allows it), never in a url, never in a log or an error message (`redact` removes every header value). A redirect to
 * another host is followed without them.
 */

export interface GraphFailure {
  /** Meta's error code when it gave one, else the http status. */
  code: string;
  message: string;
  retryable: boolean;
  /** The failure is about the credentials (revoked, expired, no permission). */
  auth: boolean;
  /** The object does not exist (any more). */
  gone: boolean;
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

/**
 * The provider's answer to a failed call as a decision. 190 (expired or invalid token) and 200-299 (permissions) are about the
 * credentials; 100 with subcode 33 and plain 404 mean the object is gone (an expired media id); 4, 17, 32, 613, 80007 and 130429 are
 * rate limits; a 5xx or 429 is worth another try; any other 4xx is not.
 */
export function classifyGraphFailure(
  status: number,
  rawBody: string,
  ...secrets: string[]
): GraphFailure {
  let body: GraphErrorBody = {};
  try {
    body = JSON.parse(rawBody) as GraphErrorBody;
  } catch {
    // not json: the status decides
  }
  const code = body.error?.code;
  const sub = body.error?.error_subcode;
  const message = redact(
    body.error?.message ?? `The provider answered ${status}`,
    ...secrets,
  ).slice(0, 300);
  const auth =
    code === 190 ||
    (code !== undefined && code >= 200 && code < 300) ||
    status === 401 ||
    status === 403;
  const gone = (code === 100 && sub === 33) || status === 404 || status === 410;
  const rateLimited = status === 429 || [4, 17, 32, 613, 80007, 130429].includes(code ?? -1);
  const serverSide = status >= 500;
  return {
    code: code !== undefined ? String(code) : String(status),
    message,
    retryable: !auth && !gone && (rateLimited || serverSide),
    auth,
    gone,
  };
}

/**
 * The same decision for a call that went through `WabaHttp`, which has already decoded the error (HTTP status 0 means the connection
 * failed before any answer, which is worth another try).
 */
export function classifyWabaFailure(err: WabaApiError, ...secrets: string[]): GraphFailure {
  const message = redact(err.message, ...secrets).slice(0, 300);
  if (err.status === 0) return { code: '0', message, retryable: true, auth: false, gone: false };
  const code = err.code ?? undefined;
  const sub = err.subcode ?? undefined;
  const status = err.status;
  const auth =
    code === 190 ||
    (code !== undefined && code >= 200 && code < 300) ||
    status === 401 ||
    status === 403;
  const gone = (code === 100 && sub === 33) || status === 404 || status === 410;
  const rateLimited = status === 429 || [4, 17, 32, 613, 80007, 130429].includes(code ?? -1);
  return {
    code: code !== undefined ? String(code) : String(status),
    message,
    retryable: !auth && !gone && (rateLimited || status >= 500 || err.transient),
    auth,
    gone,
  };
}

export interface MediaLookup {
  url: string;
  mime: string | null;
  sha256: string | null;
  fileSize: number | null;
}

export interface DownloadedStream {
  stream: Readable;
  /** What the server announced, when it did. Used as an early refusal; the byte counter is the real limit. */
  contentLength: number | null;
  contentType: string | null;
}

export class GraphMediaClient {
  constructor(
    private readonly cfg: WhatsappMediaConfig,
    private readonly http: WabaHttp,
    private readonly resolver?: DnsResolver,
  ) {}

  /** `GET {root}/{media-id}`: resolves the id to a short-lived download url. */
  async lookup(
    profile: MediaProviderProfile,
    ctx: MediaAuthContext,
    mediaId: string,
  ): Promise<MediaLookup> {
    if (!isSafeMediaId(mediaId)) {
      throw new MediaFetchError(
        MEDIA_FAILURE.UNEXPECTED,
        'The media id is not one WhatsApp issues',
        false,
      );
    }
    const auth = this.auth(ctx);
    // `phone_number_id` makes Meta refuse an id that belongs to another number: an id from a forged webhook cannot make us fetch
    // another business's file with this business's credentials. A proxy may not know the parameter, so it is sent on the Meta route only.
    const withPhone = ctx.route === 'meta';
    let json: { url?: unknown; mime_type?: unknown; sha256?: unknown; file_size?: unknown };
    try {
      json = await this.http.call(auth, {
        method: 'GET',
        path: `/${mediaId}`,
        query: withPhone && ctx.phoneNumberId ? { phone_number_id: ctx.phoneNumberId } : undefined,
        timeoutMs: this.cfg.requestTimeoutMs,
      });
    } catch (err) {
      throw this.failureOf(err, profile, ctx);
    }
    if (typeof json.url !== 'string' || json.url === '') {
      throw new MediaFetchError(
        MEDIA_FAILURE.UNEXPECTED,
        'The media lookup answered without a download address',
        true,
      );
    }
    const size = Number(json.file_size);
    return {
      url: json.url,
      mime: typeof json.mime_type === 'string' ? json.mime_type : null,
      sha256: typeof json.sha256 === 'string' ? json.sha256 : null,
      fileSize: Number.isFinite(size) && size >= 0 ? size : null,
    };
  }

  /**
   * `GET <download url>`. Follows at most `maxRedirects` redirects, each one re-checked by the guard (a redirect to a private address, to
   * http, or to a host that is not already allowed is refused). The provider's headers go only where `downloadAuthApplies` says (its own
   * host, Meta's media hosts), and are dropped when a redirect changes host. Returns the body as a stream; the caller enforces the byte
   * limit while reading.
   */
  async download(
    profile: MediaProviderProfile,
    ctx: MediaAuthContext,
    downloadUrl: string,
    signal?: AbortSignal,
  ): Promise<DownloadedStream> {
    const headers = this.authHeaders(profile, ctx);
    const policy = downloadPolicy(profile, this.cfg, downloadUrl);
    let url = downloadUrl;
    let carryAuth = true;

    for (let hop = 0; ; hop += 1) {
      const host = new URL(url).hostname;
      const res = await safeRequest({
        method: 'GET',
        url,
        headers: carryAuth && downloadAuthApplies(host, profile) ? headers : {},
        policy,
        requestTimeoutMs: this.cfg.requestTimeoutMs,
        idleTimeoutMs: this.cfg.idleTimeoutMs,
        signal,
        resolver: this.resolver,
      });

      if (res.status >= 300 && res.status < 400) {
        res.body.destroy();
        const location = res.headers.location;
        if (!location)
          throw new MediaFetchError(
            MEDIA_FAILURE.UNEXPECTED,
            'The download was redirected without a location',
            false,
          );
        if (hop >= this.cfg.maxRedirects) {
          throw new MediaFetchError(
            MEDIA_FAILURE.URL_REJECTED,
            'Download address refused: too many redirects',
            false,
          );
        }
        const next = new URL(location, url);
        if (next.host !== new URL(url).host) carryAuth = false; // the credentials belong to the host that asked for them
        url = next.toString();
        continue;
      }
      if (res.status !== 200) {
        const text = await readSmallBody(res, 4096).catch(() => '');
        throw this.failure(res.status, text, headers, safeUrlForLog(url));
      }
      const length = Number(res.headers['content-length']);
      return {
        stream: res.body,
        contentLength:
          Number.isFinite(length) && res.headers['content-length'] !== undefined ? length : null,
        contentType:
          typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : null,
      };
    }
  }

  /**
   * `POST {root}/{phone-number-id}/media` (multipart: `messaging_product`, `type`, `file`) through `WabaHttp`. The client sends a form as a
   * whole, so the file is read into memory first; the caller has already refused anything over the per-kind limit (the largest is a 100 MB
   * document), and the upload cache means a file is sent once per number.
   */
  async upload(
    profile: MediaProviderProfile,
    ctx: MediaAuthContext,
    file: { stream: Readable; size: number; mime: string; filename: string },
  ): Promise<string> {
    const phoneNumberId = ctx.phoneNumberId ?? '';
    if (!/^\d{1,40}$/.test(phoneNumberId)) {
      throw new MediaFetchError(
        MEDIA_FAILURE.UNEXPECTED,
        'The channel has no valid phone number id',
        false,
      );
    }
    const auth = this.auth(ctx);
    // The filename is a display hint for the recipient; quotes and line breaks would break out of the header, so they never get in.
    const safeName = file.filename.replace(/[\r\n"\\]/g, '_').slice(0, 200) || 'file';
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(chunk as Buffer);
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', file.mime);
    form.append('file', new Blob([Buffer.concat(chunks)], { type: file.mime }), safeName);

    let id: unknown;
    try {
      id = (
        await this.http.call<{ id?: unknown }>(auth, {
          method: 'POST',
          path: `/${phoneNumberId}/media`,
          form,
          timeoutMs: this.cfg.totalTimeoutMs, // the answer comes after the whole body has gone out
        })
      ).id;
    } catch (err) {
      throw this.failureOf(err, profile, ctx);
    }
    if (typeof id !== 'string' || id === '') {
      throw new MediaFetchError(
        MEDIA_FAILURE.UNEXPECTED,
        'The provider accepted the upload but returned no media id',
        true,
      );
    }
    return id;
  }

  /** The channel's credentials for `WabaHttp`; none means there is nothing to authenticate with, and nothing is sent. */
  private auth(ctx: MediaAuthContext) {
    const auth = wabaAuthOf(ctx);
    if (!auth) throw this.noCredentials();
    return auth;
  }

  /** The provider's headers for the download; none means there is nothing to authenticate with, and nothing is sent. */
  private authHeaders(
    profile: MediaProviderProfile,
    ctx: MediaAuthContext,
  ): Record<string, string> {
    const headers = profile.buildHeaders(ctx);
    if (Object.keys(headers).length === 0) throw this.noCredentials();
    return headers;
  }

  private noCredentials(): MediaFetchError {
    return new MediaFetchError(
      MEDIA_FAILURE.NO_CREDENTIALS,
      'This WhatsApp channel has no credentials for its provider, so files cannot be transferred. Reconnect the channel.',
      false,
    );
  }

  /** A failure of a call made through `WabaHttp`, as the `MediaFetchError` the pipeline acts on. */
  private failureOf(
    err: unknown,
    profile: MediaProviderProfile,
    ctx: MediaAuthContext,
  ): MediaFetchError {
    if (err instanceof MediaFetchError) return err;
    const secrets = secretsIn(profile.buildHeaders(ctx));
    if (!(err instanceof WabaApiError)) {
      return new MediaFetchError(
        MEDIA_FAILURE.DOWNLOAD_FAILED,
        redact((err as Error).message, ...secrets).slice(0, 300),
        true,
      );
    }
    const f = classifyWabaFailure(err, ...secrets);
    const code = f.auth
      ? MEDIA_FAILURE.AUTH
      : f.gone
        ? MEDIA_FAILURE.EXPIRED
        : MEDIA_FAILURE.DOWNLOAD_FAILED;
    const detail = `${f.message} (HTTP ${err.status}${f.code !== String(err.status) ? `, code ${f.code}` : ''})`;
    return Object.assign(new MediaFetchError(code, detail, f.retryable), { graph: f });
  }

  private failure(
    status: number,
    body: string,
    headers: Record<string, string>,
    where?: string,
  ): MediaFetchError {
    const f = classifyGraphFailure(status, body, ...secretsIn(headers));
    const code = f.auth
      ? MEDIA_FAILURE.AUTH
      : f.gone
        ? MEDIA_FAILURE.EXPIRED
        : MEDIA_FAILURE.DOWNLOAD_FAILED;
    const detail = `${f.message} (HTTP ${status}${f.code !== String(status) ? `, code ${f.code}` : ''})`;
    const err = new MediaFetchError(code, where ? `${detail} at ${where}` : detail, f.retryable);
    return Object.assign(err, { graph: f });
  }
}

/** The Graph failure behind a `MediaFetchError`, when there was one (the upload path maps its codes onto channel errors). */
export const graphFailureOf = (err: unknown): GraphFailure | undefined =>
  (err as { graph?: GraphFailure } | undefined)?.graph;
