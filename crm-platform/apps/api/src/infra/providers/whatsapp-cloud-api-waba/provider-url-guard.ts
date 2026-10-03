import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { checkProviderBaseUrl } from '@crm/contracts';

/**
 * The half of the provider base-URL rule that a URL cannot show: where the name POINTS. A registry provider's address is typed by a
 * platform operator and every call to it carries a credential, so it must never be a way to reach the platform's own network (the
 * metadata service, the database, an internal admin port). `checkProviderBaseUrl` (contracts) refuses the shape (https, public DNS
 * name, no credentials); this resolves the name and refuses it when ANY address it resolves to is private, loopback, link-local,
 * shared-address, multicast or reserved. IP literals never get here (the shape check refuses them) but are classified anyway.
 *
 * It runs when a provider is saved, when it is tested, and before every call through it (WabaHttp). Resolving and then connecting is
 * not atomic (a rebinding DNS server could answer differently the second time); the check narrows the window to a request and the
 * https-only rule means a rebound private address cannot present a certificate for the provider's name.
 */

export class UnsafeProviderUrlError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnsafeProviderUrlError';
  }
}

export interface PublicUrlOptions {
  /** Development only: a loopback host over plain http, and no DNS check. Never honoured when NODE_ENV is `production`. */
  allowDevHosts?: boolean;
  /** Replaced in tests. */
  resolve?: (host: string) => Promise<string[]>;
}

const defaultResolve = async (host: string): Promise<string[]> =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** True for an address a provider must not live on. */
export function isNonPublicAddress(address: string): boolean {
  const ip = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const kind = isIP(ip);
  if (kind === 4) return nonPublicV4(ip.split('.').map(Number) as [number, number, number, number]);
  if (kind === 6) return nonPublicV6(ip);
  return true; // not an address at all: refuse
}

function nonPublicV4([a, b, c]: [number, number, number, number]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

function nonPublicV6(ip: string): boolean {
  if (ip === '::' || ip === '::1') return true;
  // IPv4-mapped (::ffff:1.2.3.4 or ::ffff:0102:0304) and the NAT64 prefix carry an IPv4 address.
  const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isNonPublicAddress(mapped[1]!);
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return nonPublicV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  }
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 || // multicast
    (first === 0x2001 && ip.startsWith('2001:db8')) // documentation
  );
}

/** Throws UnsafeProviderUrlError unless `raw` is an https address on a host whose every resolved address is public. */
export async function assertPublicUrl(raw: string, options: PublicUrlOptions = {}): Promise<void> {
  const dev = options.allowDevHosts === true && process.env.NODE_ENV !== 'production';
  const verdict = checkProviderBaseUrl(raw, { allowDevLoopback: dev });
  if (!verdict.ok) throw new UnsafeProviderUrlError(verdict.reason);
  if (verdict.devLoopback || dev) return; // development only: a stand-in on the developer's own machine
  const addresses = await (options.resolve ?? defaultResolve)(verdict.host).catch(() => {
    throw new UnsafeProviderUrlError('The host name does not resolve');
  });
  if (addresses.length === 0) throw new UnsafeProviderUrlError('The host name does not resolve');
  if (addresses.some(isNonPublicAddress)) {
    throw new UnsafeProviderUrlError('The host name resolves to a private or reserved address');
  }
}
