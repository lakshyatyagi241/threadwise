import { Injectable } from '@nestjs/common';
import { ICS_FEED_URL_MAX, type IcsFeedError } from '@crm/contracts';
import { icsFeedEnv } from '../../../config/domains/ics-feed.env';
import { guardedRequest } from '../../net/guarded-http';

/**
 * Fetching a workspace's iCal feed (BL-035). A feed address is typed by a workspace admin, so the server must never be a way into its own network:
 * every request goes through the shared guarded client, which refuses loopback, private and link-local destinations at the socket's own DNS lookup
 * (no gap for DNS rebinding) and never follows a redirect by itself. Published calendars do redirect (iCloud to another host, for one), so redirects
 * are followed here, by hand and a few at a time, and each hop is a fresh request that is checked like the first.
 */
export const ICS_FEED_FETCHER = Symbol('ICS_FEED_FETCHER');

export class IcsFetchError extends Error {
  constructor(
    readonly code: IcsFeedError,
    readonly status = 0,
  ) {
    super(`iCal feed ${code}${status ? ` (${status})` : ''}`);
    this.name = 'IcsFetchError';
  }
}

export interface IcsFetchResult {
  /** `not_modified`: the validators sent matched (304); nothing to read. */
  kind: 'ok' | 'not_modified';
  text: string;
  etag: string | null;
  lastModified: string | null;
}

export interface IcsFeedFetcherPort {
  fetch(
    url: string,
    validators?: { etag?: string | null; lastModified?: string | null },
  ): Promise<IcsFetchResult>;
}

/** A syntactically acceptable feed address, normalized; `webcal(s)://` is `https://`. Null when it is not one. */
export function normalizeFeedUrl(raw: string): URL | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > ICS_FEED_URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(text.replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // Credentials in an address would be sent nowhere useful (the client does not use them) and would be stored; ask for a different address.
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  url.hash = '';
  return url;
}

@Injectable()
export class HttpIcsFeedFetcher implements IcsFeedFetcherPort {
  async fetch(
    address: string,
    validators: { etag?: string | null; lastModified?: string | null } = {},
  ): Promise<IcsFetchResult> {
    const env = icsFeedEnv();
    const first = normalizeFeedUrl(address);
    if (!first) throw new IcsFetchError('unreachable');
    let url: URL = first;
    const headers: Record<string, string> = {
      Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1',
      'User-Agent': 'CRM-Calendar-Feed/1.0',
    };
    if (validators.etag) headers['If-None-Match'] = validators.etag;
    if (validators.lastModified) headers['If-Modified-Since'] = validators.lastModified;

    for (let hop = 0; hop <= env.ICS_FEED_MAX_REDIRECTS; hop += 1) {
      let res;
      try {
        res = await guardedRequest({
          method: 'GET',
          url,
          headers,
          timeoutMs: env.ICS_FEED_HTTP_TIMEOUT_MS,
          allowPrivate: env.ICS_FEED_ALLOW_PRIVATE_ADDRESSES,
          maxBytes: env.ICS_FEED_MAX_BYTES,
        });
      } catch (err) {
        throw this.classify(err);
      }
      const status = res.status;
      if (status === 304) return { kind: 'not_modified', text: '', etag: null, lastModified: null };
      if (status >= 300 && status < 400) {
        const location = res.headers.location;
        const next: URL | null = typeof location === 'string' ? safeResolve(location, url) : null;
        if (!next) throw new IcsFetchError('unreachable', status);
        url = next;
        continue;
      }
      if (status === 404 || status === 410) throw new IcsFetchError('not_found', status);
      if (status === 401 || status === 403) throw new IcsFetchError('forbidden', status);
      if (status >= 500) throw new IcsFetchError('server_error', status);
      if (status < 200 || status >= 300) throw new IcsFetchError('unreachable', status);
      // The guarded client cuts an oversize answer at the cap: a body that reaches it is incomplete, and half a calendar is not read.
      if (Buffer.byteLength(res.body) >= env.ICS_FEED_MAX_BYTES)
        throw new IcsFetchError('too_large', status);
      const header = (name: 'etag' | 'last-modified') => {
        const v = res.headers[name];
        return typeof v === 'string' && v ? v.slice(0, 500) : null;
      };
      return {
        kind: 'ok',
        text: res.body,
        etag: header('etag'),
        lastModified: header('last-modified'),
      };
    }
    throw new IcsFetchError('redirect_loop');
  }

  private classify(err: unknown): IcsFetchError {
    const message = err instanceof Error ? err.message : '';
    if (/private networks/i.test(message)) return new IcsFetchError('blocked_address');
    if (/timed out/i.test(message)) return new IcsFetchError('timeout');
    return new IcsFetchError('unreachable');
  }
}

function safeResolve(location: string, base: URL): URL | null {
  try {
    const next = new URL(location, base);
    return next.protocol === 'https:' || next.protocol === 'http:' ? next : null;
  } catch {
    return null;
  }
}
