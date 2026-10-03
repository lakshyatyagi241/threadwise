import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF guard for the builder's webhook test (WD-FLB-024 rule 7). Only http and https; the host must resolve, and every
 * address it resolves to must be public; metadata hosts are refused by name. The caller connects to the address this
 * returns (not to the host name again), which closes the DNS-rebinding window WaDesk left between its check and its request.
 */
export type SsrfVerdict =
  | { ok: true; url: URL; address: string; family: 4 | 6 }
  | { ok: false; reason: string };

export type Resolver = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

const v4 = (ip: string): number[] | null => {
  const p = ip.split('.').map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
};

/** True for an address that is routable on the public internet (not private, loopback, link-local, reserved or multicast). */
export function isPublicIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b, c] = v4(ip)!;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b! >= 64 && b! <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b! >= 16 && b! <= 31) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a! >= 224) return false;
    return true;
  }
  if (kind === 6) {
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPublicIp(mapped[1]!);
    if (x === '::' || x === '::1') return false;
    const first = parseInt(x.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (x.startsWith('2001:db8')) return false; // documentation
    return true;
  }
  return false;
}

export async function guardSsrf(raw: string, resolve: Resolver = defaultResolver): Promise<SsrfVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http and https URLs are allowed' };
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
