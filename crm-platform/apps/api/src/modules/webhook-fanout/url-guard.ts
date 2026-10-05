import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.0\.0\./,
  /^192\.168\./,
  /^198\.1[89]\./,
  /^(22[4-9]|2[3-5]\d)\./, // multicast and reserved
];

/** True for an address a webhook target must never resolve to: loopback, private, link-local, reserved, mapped. */
export function isPrivateAddress(address: string): boolean {
  const addr = address.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(addr);
  if (kind === 4) return PRIVATE_V4.some((r) => r.test(addr));
  if (kind === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return addr === '::' || addr === '::1' || /^(fc|fd|fe[89ab])/.test(addr);
  }
  return true; // not an address at all: refuse
}

const BAD_SUFFIXES = ['.local', '.internal', '.localhost', '.test', '.lan', '.home.arpa'];

/** Shape check, no network: https, no credentials in the URL, host is not an obvious internal name or address. */
export function targetUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'The URL is not valid.';
  }
  if (url.protocol !== 'https:') return 'The URL must use https.';
  if (url.username || url.password) return 'Put credentials in the header field, not in the URL.';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || BAD_SUFFIXES.some((s) => host.endsWith(s)))
    return `Host '${host}' is internal and cannot be a target.`;
  if (isIP(host) && isPrivateAddress(host))
    return `Host '${host}' is a private or reserved address.`;
  return null;
}

/**
 * Shape check plus DNS: every address the host resolves to must be public. Called when a target is saved and again
 * right before each delivery, because a name can be repointed at an internal address after it was approved.
 * (A rebind between this lookup and the connect is a small remaining window; the target list is operator-only.)
 */
export async function assertPublicTarget(raw: string): Promise<string | null> {
  const shape = targetUrlProblem(raw);
  if (shape) return shape;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return null;
  try {
    const found = await lookup(host, { all: true });
    if (found.length === 0) return `Host '${host}' does not resolve.`;
    const bad = found.find((f) => isPrivateAddress(f.address));
    return bad ? `Host '${host}' resolves to a private address (${bad.address}).` : null;
  } catch {
    return `Host '${host}' does not resolve.`;
  }
}
