import { isIP } from 'node:net';

/** Strips the IPv4-mapped IPv6 prefix Node reports for dual-stack sockets. */
export function normalizeIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
  const value = mapped ? mapped[1]! : trimmed;
  return isIP(value) ? value : null;
}

function toBytes(ip: string): Uint8Array | null {
  const family = isIP(ip);
  if (family === 4) return Uint8Array.from(ip.split('.').map(Number));
  if (family === 6) {
    // Expand "::" and parse hextets.
    const [head, tail] = ip.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const missing = 8 - headParts.length - tailParts.length;
    const parts = [
      ...headParts,
      ...Array<string>(ip.includes('::') ? missing : 0).fill('0'),
      ...tailParts,
    ];
    if (parts.length !== 8) return null;
    const bytes = new Uint8Array(16);
    parts.forEach((p, i) => {
      const n = parseInt(p || '0', 16);
      bytes[i * 2] = (n >> 8) & 255;
      bytes[i * 2 + 1] = n & 255;
    });
    return bytes;
  }
  return null;
}

/**
 * True when `ip` is the address or inside the CIDR. A v4 address never matches
 * a v6 range and an unparsable entry never matches (it cannot widen access).
 */
export function ipMatches(ip: string, entry: string): boolean {
  const addr = normalizeIp(ip);
  if (!addr) return false;
  const [base, prefixRaw] = entry.trim().split('/');
  if (!base) return false;
  const baseIp = normalizeIp(base);
  if (!baseIp) return false;
  if (isIP(addr) !== isIP(baseIp)) return false;
  if (prefixRaw === undefined) return addr === baseIp;

  const prefix = Number(prefixRaw);
  const max = isIP(addr) === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return false;

  const a = toBytes(addr);
  const b = toBytes(baseIp);
  if (!a || !b) return false;
  let remaining = prefix;
  for (let i = 0; i < a.length && remaining > 0; i++) {
    const bits = Math.min(8, remaining);
    const mask = (0xff << (8 - bits)) & 0xff;
    if ((a[i]! & mask) !== (b[i]! & mask)) return false;
    remaining -= bits;
  }
  return true;
}

export const ipAllowed = (ip: string, entries: string[]): boolean =>
  entries.some((e) => ipMatches(ip, e));

/** Valid IP or CIDR, so a typo is rejected at save time instead of silently never matching. */
export function isValidAllowlistEntry(entry: string): boolean {
  const [base, prefix] = entry.trim().split('/');
  if (!base || !normalizeIp(base)) return false;
  if (prefix === undefined) return true;
  const n = Number(prefix);
  const max = isIP(base) === 4 ? 32 : 128;
  return Number.isInteger(n) && n >= 0 && n <= max;
}

/**
 * "Same network" heuristic Reference used for new-country alerts: first two IPv4
 * octets, or first four hextets for IPv6. There is no geo database here.
 */
export function networkPrefix(ip: string | null): string | null {
  const addr = normalizeIp(ip);
  if (!addr) return null;
  if (isIP(addr) === 4) return addr.split('.').slice(0, 2).join('.');
  const bytes = toBytes(addr);
  return bytes ? Array.from(bytes.slice(0, 8)).join('.') : null;
}
