import { isIP } from 'node:net';

/**
 * The one address rule for every outbound request to an operator-supplied or provider-supplied address (SSRF guards). A guard decides
 * which names and schemes it accepts; whether an address may be connected to is decided here, so the guards cannot drift apart.
 *
 * The rule is a deny list over what is not routable on the public internet. IPv6 forms that carry an IPv4 address (mapped, NAT64, 6to4)
 * are judged by the address inside them. Node writes `http://[::ffff:127.0.0.1]/` as the host `[::ffff:7f00:1]` and DNS can answer in
 * that form too, so the dotted form is only one of the spellings that must be caught.
 */

const inV4 = (o: number[], a: number, b: number, c?: number): boolean =>
  o[0] === a && o[1] === b && (c === undefined || o[2] === c);

/** True for an IPv4 address that must never be reached: private, loopback, link-local, CGNAT, documentation, benchmark, multicast, reserved. */
function blockedV4(o: number[]): boolean {
  const [a, b] = [o[0]!, o[1]!];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    inV4(o, 192, 0, 0) ||
    inV4(o, 192, 0, 2) ||
    inV4(o, 192, 88, 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    inV4(o, 198, 51, 100) ||
    inV4(o, 203, 0, 113) ||
    a >= 224
  );
}

/** The eight 16-bit groups of an IPv6 address (the `::` expanded, a trailing dotted IPv4 converted, a zone id dropped), or null. */
export function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const p = dotted.slice(1).map(Number);
    if (p.some((n) => n > 255)) return null;
    s =
      s.slice(0, dotted.index) +
      `${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.length === 8 && out.every((n) => !Number.isNaN(n)) ? out : null;
}

const v4Of = (hi: number, lo: number): number[] => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/**
 * Whether an address must not be connected to: loopback, private, link-local (the cloud metadata address included), carrier NAT,
 * unspecified, multicast, reserved, documentation, unique-local and site-local IPv6, Teredo, and every IPv6 spelling of an IPv4
 * address that is itself blocked (IPv4-mapped in dotted or hex form, NAT64, 6to4). The deprecated IPv4-compatible `::/96` is blocked
 * whole. Text that is not an address at all is blocked.
 */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return blockedV4(address.split('.').map(Number));
  if (kind !== 6) return true;
  const g = ipv6Groups(address);
  if (!g) return true;
  if (g.slice(0, 5).every((x) => x === 0)) {
    if (g[5] === 0xffff) return blockedV4(v4Of(g[6]!, g[7]!)); // mapped
    if (g[5] === 0) return true; // ::, ::1 and the deprecated compatible form
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return blockedV4(v4Of(g[6]!, g[7]!)); // NAT64
  }
  if (g[0] === 0x2002) return blockedV4(v4Of(g[1]!, g[2]!)); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return true; // 100::/64 discard
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // link local
  if ((g[0]! & 0xffc0) === 0xfec0) return true; // site local (deprecated)
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  return false;
}
