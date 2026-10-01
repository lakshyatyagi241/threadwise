/**
 * IP and CIDR helpers for the allowlist screen. They mirror the API's matching
 * rules (exact address, or a prefix compared bit by bit; a v4 address never
 * matches a v6 range; an unparsable entry never matches) so the self-lockout
 * hint agrees with what the server will decide.
 */

interface ParsedIp {
  family: 4 | 6;
  bytes: Uint8Array;
}

function parseV4(text: string): Uint8Array | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const p = parts[i]!;
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

function parseV6(text: string): Uint8Array | null {
  if (!/^[0-9a-fA-F:.]+$/.test(text) || text.includes(':::')) return null;
  let work = text;
  let tail: number[] = [];
  const lastColon = work.lastIndexOf(':');
  if (work.slice(lastColon + 1).includes('.')) {
    const v4 = parseV4(work.slice(lastColon + 1));
    if (!v4) return null;
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    work = work.slice(0, lastColon + 1) + '0:0';
  }
  const halves = work.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === '' ? [] : s.split(':'));
  const head = toGroups(halves[0]!);
  const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups =
    halves.length === 1 ? head : [...head, ...Array<string>(missing).fill('0'), ...rest];
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = groups[i]!;
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes[i * 2] = n >> 8;
    bytes[i * 2 + 1] = n & 255;
  }
  if (tail.length === 2) {
    bytes[12] = tail[0]! >> 8;
    bytes[13] = tail[0]! & 255;
    bytes[14] = tail[1]! >> 8;
    bytes[15] = tail[1]! & 255;
  }
  return bytes;
}

/** Strips the IPv4-mapped IPv6 prefix, as the API does. */
export function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
  const value = mapped ? mapped[1]! : trimmed;
  return parseIp(value) ? value : null;
}

export function parseIp(text: string): ParsedIp | null {
  const v4 = parseV4(text);
  if (v4) return { family: 4, bytes: v4 };
  const v6 = text.includes(':') ? parseV6(text) : null;
  return v6 ? { family: 6, bytes: v6 } : null;
}

/** A valid address or CIDR, so a typo is caught before it silently never matches. */
export function isValidAllowlistEntry(entry: string): boolean {
  const [base, prefix, ...extra] = entry.trim().split('/');
  if (extra.length > 0 || !base) return false;
  const ip = normalizeIp(base);
  if (!ip) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const max = parseIp(ip)!.family === 4 ? 32 : 128;
  return Number(prefix) <= max;
}

export function ipMatches(ip: string, entry: string): boolean {
  const addr = normalizeIp(ip);
  if (!addr) return false;
  const [base, prefixRaw] = entry.trim().split('/');
  const baseIp = normalizeIp(base);
  if (!baseIp) return false;
  const a = parseIp(addr)!;
  const b = parseIp(baseIp)!;
  if (a.family !== b.family) return false;
  if (prefixRaw === undefined) return addr === baseIp || a.bytes.every((v, i) => v === b.bytes[i]);
  const prefix = Number(prefixRaw);
  const max = a.family === 4 ? 32 : 128;
  if (!/^\d{1,3}$/.test(prefixRaw) || prefix > max) return false;
  let remaining = prefix;
  for (let i = 0; i < a.bytes.length && remaining > 0; i++) {
    const bits = Math.min(8, remaining);
    const mask = (0xff << (8 - bits)) & 0xff;
    if ((a.bytes[i]! & mask) !== (b.bytes[i]! & mask)) return false;
    remaining -= bits;
  }
  return true;
}

export const ipAllowed = (ip: string, entries: readonly string[]): boolean =>
  entries.some((e) => ipMatches(ip, e));

/**
 * True when saving this allowlist would cut the caller off: it is on, it has
 * entries (an empty list lets everyone in), and the caller's own address is
 * not covered. Unknown caller address -> false (nothing to compare).
 */
export function wouldLockOut(
  yourIp: string | null,
  enabled: boolean,
  entries: readonly string[],
): boolean {
  const addr = normalizeIp(yourIp);
  if (!enabled || entries.length === 0 || !addr) return false;
  return !ipAllowed(addr, entries);
}
