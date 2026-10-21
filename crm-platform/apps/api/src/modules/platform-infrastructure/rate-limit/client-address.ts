import { isIP } from 'node:net';

/**
 * The part of a rate-limit key that names the client's address.
 *
 * - IPv4 stays as it is.
 * - An IPv4-mapped IPv6 address (`::ffff:1.2.3.4`, which a dual-stack socket reports for an IPv4 client) is the same client as
 *   `1.2.3.4` and must share its counter.
 * - Any other IPv6 address is counted by its /64. A household, a phone line or a hosting plan is handed a whole /64 (2^64 addresses)
 *   and can pick any address in it, so a counter per full address is a counter an attacker never has to share.
 * - Anything that is not an address at all falls in one `unknown` bucket, as a missing address always has.
 */
export function clientKey(ip: string | undefined | null): string {
  if (!ip) return 'unknown';
  const raw = ip.trim().replace(/%.*$/, ''); // a zone id (fe80::1%eth0) is not part of the address
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  const value = mapped ? mapped[1]! : raw;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return 'unknown';
  const hextets = expandIPv6(value);
  return hextets
    ? `${hextets
        .slice(0, 4)
        .map((h) => h.toString(16))
        .join(':')}::/64`
    : 'unknown';
}

/** The eight 16-bit groups of an IPv6 address, or null if it cannot be read. Handles `::` and an embedded IPv4 tail. */
function expandIPv6(address: string): number[] | null {
  let addr = address.toLowerCase();
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (tail) {
    const p = tail[1]!.split('.').map(Number);
    addr =
      addr.slice(0, -tail[1]!.length) +
      ((p[0]! << 8) | p[1]!).toString(16) +
      ':' +
      ((p[2]! << 8) | p[3]!).toString(16);
  }
  const [head = '', rest, extra] = addr.split('::');
  if (extra !== undefined) return null;
  const a = head ? head.split(':') : [];
  const b = rest !== undefined && rest ? rest.split(':') : [];
  const fill = rest === undefined ? 0 : 8 - a.length - b.length;
  if (fill < 0 || (rest === undefined && a.length !== 8)) return null;
  const all = [...a, ...Array<string>(fill).fill('0'), ...b].map((h) => parseInt(h, 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? all
    : null;
}
