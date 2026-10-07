import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isBlockedAddress } from './blocked-address';
import {
  BlockedAddressError,
  safeGet,
  type SafeGetOptions,
  type SafeGetResponse,
} from './safe-get';
import type { TrainingUrlFetcher, TrainingUrlResult } from './training-url-fetcher.port';

const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const BLOCKED = 'host resolves to a private/reserved IP: refusing to fetch';
/** A page larger than this is cut: the text kept is capped far lower, so the rest would only cost memory. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Operator-supplied address, so every hop is checked. Redirects are followed by hand (up to five) and each `Location` goes through the
 * same checks as the first URL: a public host answering 302 to the cloud metadata address would otherwise walk past a one-shot guard
 * (WaDesk disables automatic redirects for the same reason). `safeGet` checks the address inside the socket's own DNS lookup, so
 * the address that passed is the address connected to (no resolve-then-connect gap for DNS rebinding). Only http and https; metadata
 * host names are refused by name; the body is capped and the request times out.
 */
@Injectable()
export class HttpTrainingUrlFetcher implements TrainingUrlFetcher {
  /** The one place a socket is opened; tests replace it. */
  request: (url: URL, opts: SafeGetOptions) => Promise<SafeGetResponse> = safeGet;

  async fetch(raw: string): Promise<TrainingUrlResult> {
    let current = raw;
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const refused = await refuse(current);
        if (refused) return { ok: false, error: refused };
        const res = await this.request(new URL(current), {
          headers: { 'User-Agent': 'AITrainingBot/1.0', Accept: 'text/html,text/plain,*/*;q=0.5' },
          timeoutMs: TIMEOUT_MS,
          maxBytes: MAX_BYTES,
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.location;
          if (!location) break;
          if (hop === MAX_REDIRECTS) return { ok: false, error: 'too many redirects' };
          current = new URL(String(location), current).toString();
          continue;
        }
        if (res.status < 200 || res.status >= 300) {
          return { ok: false, error: `fetch failed: HTTP ${res.status}` };
        }
        const type = res.headers['content-type'];
        return { ok: true, body: res.body, contentType: typeof type === 'string' ? type : null };
      }
      return { ok: false, error: 'fetch failed: HTTP 3xx' };
    } catch (err) {
      return { ok: false, error: describe(err) };
    }
  }
}

/** The reason a URL must not be fetched, or null. Checks the scheme, the host name and the addresses it resolves to. */
async function refuse(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid URL';
  }
  if (!url.hostname) return 'invalid URL';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `scheme ${url.protocol.slice(0, -1)} not allowed (use http or https)`;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host.includes('metadata.') || host.endsWith('.internal')) return 'metadata host not allowed';
  if (isIP(host)) {
    return isBlockedAddress(host) ? BLOCKED : null;
  }
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    return 'hostname did not resolve to a public IP';
  }
  if (addrs.length === 0) return 'hostname did not resolve to a public IP';
  if (addrs.some((a) => isBlockedAddress(a.address))) return BLOCKED;
  return null;
}

/** A sentence for the entry: never a stack, a socket address or a file path. */
function describe(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (err instanceof BlockedAddressError) return BLOCKED;
  if (/timed out/i.test(msg)) return 'fetch failed: timed out';
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'hostname did not resolve to a public IP';
  return 'fetch failed: could not reach the page';
}
