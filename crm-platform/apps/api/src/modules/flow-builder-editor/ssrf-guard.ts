import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isBlockedAddress } from '../../infra/net/blocked-address';

/**
 * SSRF guard for the builder's webhook test (TW-FLB-024 rule 7). Only http and https; the host must resolve, and every
 * address it resolves to must be public; metadata hosts are refused by name. The caller connects to the address this
 * returns (not to the host name again), which closes the DNS-rebinding window Reference left between its check and its request.
 */
export type SsrfVerdict =
  { ok: true; url: URL; address: string; family: 4 | 6 } | { ok: false; reason: string };

export type Resolver = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

/** True for an address that is routable on the public internet (not private, loopback, link-local, reserved or multicast). */
export function isPublicIp(ip: string): boolean {
  return !isBlockedAddress(ip);
}

export async function guardSsrf(
  raw: string,
  resolve: Resolver = defaultResolver,
): Promise<SsrfVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  // Reference's wording: a URL without a host (`mailto:x`, `javascript:...`) is invalid; another scheme names itself.
  if (!url.hostname) return { ok: false, reason: 'invalid URL' };
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      reason: `scheme ${url.protocol.slice(0, -1)} not allowed (use http or https)`,
    };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host.includes('metadata.') || host.endsWith('.internal')) {
    return { ok: false, reason: 'metadata host not allowed' };
  }
  let addrs: Array<{ address: string; family: number }>;
  if (isIP(host)) {
    addrs = [{ address: host, family: isIP(host) }];
  } else {
    try {
      addrs = await resolve(host);
    } catch {
      addrs = [];
    }
  }
  if (addrs.length === 0) return { ok: false, reason: 'hostname did not resolve to a public IP' };
  for (const a of addrs) {
    if (!isPublicIp(a.address)) {
      return { ok: false, reason: `host resolves to a private/reserved IP (${a.address})` };
    }
  }
  const first = addrs[0]!;
  return { ok: true, url, address: first.address, family: first.family === 6 ? 6 : 4 };
}
