import { Inject, Injectable } from '@nestjs/common';
import { WABA_ENV, type WabaEnv } from '../../../config/domains/whatsapp-cloud-api-waba.env';
import { WabaApiError } from './waba-errors';

/** Which API a number is reached through. Same Cloud API paths either way; only host, version and auth headers differ. */
export type WabaProviderKind = 'interakt' | 'meta';

export interface WabaMetaAuth {
  provider: 'meta';
  /** Business-integration user token (Embedded Signup) or a System User token (manual connect). */
  accessToken: string;
}

export interface WabaInteraktAuth {
  provider: 'interakt';
  /** The shared tech-partner key. */
  authKey: string;
  wabaId: string;
  /** Only the Flow-assets upload and the per-phone callback override send `x-phone-number-id`. */
  phoneNumberId?: string;
}

export type WabaAuth = WabaMetaAuth | WabaInteraktAuth;

export type WabaQuery = Record<string, string | number | boolean | null | undefined>;

export interface WabaRequest {
  method: 'GET' | 'POST' | 'DELETE';
  /** Cloud API path with a leading slash, relative to the versioned base: `/{phone_number_id}/messages`. */
  path: string;
  query?: WabaQuery;
  json?: unknown;
  form?: FormData;
  /** Raw bytes (the resumable-upload step). Sent as given; set the content type through `headers`. */
  body?: Uint8Array;
  /** Overrides the configured version for this call (Interakt's `/media_handle` only exists on an older one). */
  apiVersion?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The one place that talks HTTP to Meta Graph and Interakt: base URL, version, auth headers, timeout, JSON decoding and error
 * normalisation. Nothing above the provider adapters builds a URL or a header.
 *
 * Every call has a timeout (Geta's WhatsApp service has none and a hung socket holds a worker). Tokens go in headers, never in
 * the query string, so they cannot land in access logs.
 */
@Injectable()
export class WabaHttp {
  /** Resolved per call so a test (or a runtime patch) that replaces global fetch is honoured. */
  fetchImpl: FetchLike = (input, init) => fetch(input, init);

  constructor(@Inject(WABA_ENV) private readonly env: WabaEnv) {}

  /** `https://graph.facebook.com/v25.0` or `https://amped-express.interakt.ai/api/v25.0`. */
  baseUrl(provider: WabaProviderKind, apiVersion?: string): string {
    if (provider === 'interakt') {
      return `${trimSlash(this.env.INTERAKT_API_ENDPOINT)}/${apiVersion ?? this.env.INTERAKT_API_VERSION}`;
    }
    return `${trimSlash(this.env.META_API_ENDPOINT)}/${apiVersion ?? this.env.META_API_VERSION}`;
  }

  headers(auth: WabaAuth, extra?: Record<string, string>): Record<string, string> {
    const base: Record<string, string> =
      auth.provider === 'interakt'
        ? { 'x-access-token': auth.authKey, 'x-waba-id': auth.wabaId }
        : { authorization: `Bearer ${auth.accessToken}` };
    if (auth.provider === 'interakt' && auth.phoneNumberId)
      base['x-phone-number-id'] = auth.phoneNumberId;
    return { ...base, ...extra };
  }

  /** A Cloud API call through the number's own route. */
  async call<T = Record<string, unknown>>(auth: WabaAuth, req: WabaRequest): Promise<T> {
    const url = this.url(this.baseUrl(auth.provider, req.apiVersion), req.path, req.query);
    return this.send<T>(url, req, this.headers(auth, req.headers));
  }

  /** A call to Meta Graph itself, whatever the number's route: the Embedded Signup exchange and platform lookups. */
  async graph<T = Record<string, unknown>>(bearer: string | null, req: WabaRequest): Promise<T> {
    const url = this.url(this.baseUrl('meta', req.apiVersion), req.path, req.query);
    const headers = bearer
      ? { authorization: `Bearer ${bearer}`, ...req.headers }
      : { ...req.headers };
    return this.send<T>(url, req, headers);
  }

  /** A fully formed URL (a paging cursor, Interakt's partner signup). Auth headers are the caller's. */
  async absolute<T = Record<string, unknown>>(
    url: string,
    req: Omit<WabaRequest, 'path' | 'query' | 'apiVersion'>,
  ): Promise<T> {
    return this.send<T>(url, req, req.headers ?? {});
  }

  private url(base: string, path: string, query?: WabaQuery): string {
    const u = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private async send<T>(
    url: string,
    req: Pick<WabaRequest, 'method' | 'json' | 'form' | 'body' | 'timeoutMs'>,
    headers: Record<string, string>,
  ): Promise<T> {
    const init: RequestInit = {
      method: req.method,
      headers: { ...headers },
      signal: AbortSignal.timeout(req.timeoutMs ?? this.env.WABA_HTTP_TIMEOUT_MS),
    };
    if (req.body) {
      init.body = req.body as unknown as RequestInit['body'];
    } else if (req.form) {
      // No content-type: fetch writes the multipart boundary itself.
      init.body = req.form;
    } else if (req.json !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify(req.json);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (cause) {
      throw WabaApiError.network(cause);
    }

    const text = await res.text().catch(() => '');
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 2000) };
      }
    }
    if (!res.ok) throw WabaApiError.fromResponse(res.status, body);
    return body as T;
  }
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');
