import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  downloadAuthApplies,
  downloadPolicy,
  isMetaMediaHost,
  providerPolicy,
  type DnsResolver,
} from './media-url-guard';
import { MEDIA_FAILURE, MediaFetchError, redact, safeUrlForLog } from './media-fetch-error';
import {
  providerHostOf,
  rootOf,
  secretsIn,
  type MediaAuthContext,
  type MediaProviderProfile,
} from './media-provider';
import { isSafeMediaId } from './whatsapp-media-rules';
import { readSmallBody, safeRequest } from './safe-http';
import type { WhatsappMediaConfig } from './whatsapp-media.config';

/**
 * The three calls the media pipeline makes, each through `safeRequest` and each against the channel's provider profile:
 *
 *   lookup    `GET  {root}/{media-id}`              -> the temporary download url, mime, sha256, size
 *   download  `GET  <that url>`                     -> the bytes, as a stream
 *   upload    `POST {root}/{phone-number-id}/media` -> a media id for an outbound file
 *
 * `{root}` and the authentication headers come from the profile (direct Meta: the Graph address and `Authorization: Bearer`; a BSP
 * proxy: its own address and its own headers), never from a constant here. The headers are placed only on requests to the provider's
 * own host (and, for a download, Meta's media hosts when the profile allows it); they are never put in a url, never logged, and never
 * part of an error message (`redact` removes every header value). A redirect to another host is followed without them.
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
export function classifyGraphFailure(status: number, rawBody: string, ...secrets: string[]): GraphFailure {
  let body: GraphErrorBody = {};
  try {
    body = JSON.parse(rawBody) as GraphErrorBody;
  } catch {
    // not json: the status decides
  }
  const code = body.error?.code;
  const sub = body.error?.error_subcode;
  const message = redact(body.error?.message ?? `The provider answered ${status}`, ...secrets).slice(0, 300);
  const auth = code === 190 || (code !== undefined && code >= 200 && code < 300) || status === 401 || status === 403;
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
    private readonly resolver?: DnsResolver,
  ) {}

  /** `GET {root}/{media-id}`: resolves the id to a short-lived download url. */
  async lookup(
    profile: MediaProviderProfile,
    ctx: MediaAuthContext,
    mediaId: string,
    signal?: AbortSignal,
  ): Promise<MediaLookup> {
    if (!isSafeMediaId(mediaId)) {
      throw new MediaFetchError(MEDIA_FAILURE.UNEXPECTED, 'The media id is not one WhatsApp issues', false);
    }
    const headers = this.authHeaders(profile, ctx);
    // `phone_number_id` makes Meta refuse an id that belongs to another number: an id from a forged webhook cannot make us fetch
    // another business's file with this business's credentials. A proxy may not know the parameter, so it is sent to Meta's host only.
    const withPhone = isMetaMediaHost(providerHostOf(profile));
    const query = withPhone && ctx.phoneNumberId ? `?phone_number_id=${encodeURIComponent(ctx.phoneNumberId)}` : '';

    const res = await safeRequest({
      method: 'GET',
      url: `${rootOf(profile)}/${mediaId}${query}`,
      headers: { ...headers, accept: 'application/json' },
      policy: providerPolicy(profile, this.cfg),
      requestTimeoutMs: this.cfg.requestTimeoutMs,
      idleTimeoutMs: this.cfg.idleTimeoutMs,
      signal,
      resolver: this.resolver,
    });
    const text = await readSmallBody(res);
    if (res.status !== 200) throw this.failure(res.status, text, headers);

    let json: { url?: unknown; mime_type?: unknown; sha256?: unknown; file_size?: unknown };
    try {
      json = JSON.parse(text);
    } catch {
      throw new MediaFetchError(MEDIA_FAILURE.UNEXPECTED, 'The media lookup answered with something that is not JSON', true);
    }
    if (typeof json.url !== 'string' || json.url === '') {
      throw new MediaFetchError(MEDIA_FAILURE.UNEXPECTED, 'The media lookup answered without a download address', true);
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
        if (!location) throw new MediaFetchError(MEDIA_FAILURE.UNEXPECTED, 'The download was redirected without a location', false);
        if (hop >= this.cfg.maxRedirects) {
          throw new MediaFetchError(MEDIA_FAILURE.URL_REJECTED, 'Download address refused: too many redirects', false);
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
        contentLength: Number.isFinite(length) && res.headers['content-length'] !== undefined ? length : null,
        contentType: typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : null,
      };
    }
  }

  /**
   * `POST {root}/{phone-number-id}/media` (multipart: `messaging_product`, `type`, `file`). The file is streamed from `file.stream`,
   * whose exact length the caller supplies so the request can announce a content length and nothing is buffered.
   */
  async upload(
    profile: MediaProviderProfile,
    ctx: MediaAuthContext,
    file: { stream: Readable; size: number; mime: string; filename: string },
    signal?: AbortSignal,
  ): Promise<string> {
    const phoneNumberId = ctx.phoneNumberId ?? '';
    if (!/^\d{1,40}$/.test(phoneNumberId)) {
      throw new MediaFetchError(MEDIA_FAILURE.UNEXPECTED, 'The channel has no valid phone number id', false);
    }
    const headers = this.authHeaders(profile, ctx);
    const boundary = `----crm${randomBytes(12).toString('hex')}`;
    const field = (name: string, value: string) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    // The filename is a display hint for the recipient; quotes and line breaks would break out of the header, so they never get in.
    const safeName = file.filename.replace(/[\r\n"\\]/g, '_').slice(0, 200) || 'file';
    const head = Buffer.from(
      field('messaging_product', 'whatsapp') +
        field('type', file.mime) +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

    async function* body(): AsyncGenerator<Buffer> {
      yield head;
      for await (const chunk of file.stream) yield chunk as Buffer;
      yield tail;
    }
    const res = await safeRequest({
      method: 'POST',
      url: `${rootOf(profile)}/${phoneNumberId}/media`,
      headers: {
        ...headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(head.length + file.size + tail.length),
        accept: 'application/json',
      },
      body: Readable.from(body()),
      policy: providerPolicy(profile, this.cfg),
      requestTimeoutMs: this.cfg.totalTimeoutMs, // the answer comes after the whole body has gone out
      idleTimeoutMs: this.cfg.idleTimeoutMs,
      signal,
      resolver: this.resolver,
    });
    const text = await readSmallBody(res);
    if (res.status !== 200) throw this.failure(res.status, text, headers);
    let id: unknown;
    try {
      id = (JSON.parse(text) as { id?: unknown }).id;
    } catch {
      id = undefined;
    }
    if (typeof id !== 'string' || id === '') {
      throw new MediaFetchError(MEDIA_FAILURE.UNEXPECTED, 'The provider accepted the upload but returned no media id', true);
    }
    return id;
  }

  /** The provider's headers for this channel; none means there is nothing to authenticate with, and nothing is sent. */
  private authHeaders(profile: MediaProviderProfile, ctx: MediaAuthContext): Record<string, string> {
    const headers = profile.buildHeaders(ctx);
    if (Object.keys(headers).length === 0) {
      throw new MediaFetchError(
        MEDIA_FAILURE.NO_CREDENTIALS,
        'This WhatsApp channel has no credentials for its provider, so files cannot be transferred. Reconnect the channel.',
        false,
      );
    }
    return headers;
  }

  private failure(status: number, body: string, headers: Record<string, string>, where?: string): MediaFetchError {
    const f = classifyGraphFailure(status, body, ...secretsIn(headers));
    const code = f.auth ? MEDIA_FAILURE.AUTH : f.gone ? MEDIA_FAILURE.EXPIRED : MEDIA_FAILURE.DOWNLOAD_FAILED;
    const detail = `${f.message} (HTTP ${status}${f.code !== String(status) ? `, code ${f.code}` : ''})`;
    const err = new MediaFetchError(code, where ? `${detail} at ${where}` : detail, f.retryable);
    return Object.assign(err, { graph: f });
  }
}

/** The Graph failure behind a `MediaFetchError`, when there was one (the upload path maps its codes onto channel errors). */
export const graphFailureOf = (err: unknown): GraphFailure | undefined =>
  (err as { graph?: GraphFailure } | undefined)?.graph;
