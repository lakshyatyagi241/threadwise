import { isIP } from 'node:net';
import { ipv6Groups } from '../../net/blocked-address';

/** The IPv4 address an IPv6 literal carries (IPv4-mapped in either spelling, NAT64, 6to4), or null. */
function embeddedV4(host: string): number[] | null {
  if (isIP(host) !== 6) return null;
  const g = ipv6Groups(host);
  if (!g) return null;
  const v4 = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4(g[6]!, g[7]!);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
    return v4(g[6]!, g[7]!);
  if (g[0] === 0x2002) return v4(g[1]!, g[2]!);
  return null;
}

/**
 * Validates the endpoint an operator types for a self-hosted translation server (TW-I18N-026 port note).
 *
 * Loopback and private ranges stay allowed on purpose: a self-hosted LibreTranslate usually runs next to the API
 * (`http://localhost:5000` is the documented default). What is refused is the class of addresses that can only be a
 * mistake or an attack: link-local (including the 169.254.169.254 cloud metadata service), the metadata hostnames
 * and non-http schemes.
 */
export function endpointProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'The endpoint must be a full URL such as http://localhost:5000.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'The endpoint must start with http:// or https://.';
  }
  if (url.username || url.password) return 'Put credentials in the API key field, not in the URL.';

  // A trailing dot names the same host (`metadata.google.internal.`), so it is dropped before the names are compared.
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
  if (host === 'metadata.google.internal' || host === 'metadata') {
    return 'That address is not allowed.';
  }
  // IPv4 link-local 169.254.0.0/16 and IPv6 link-local fe80::/10.
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return 'That address is not allowed.';
  if (/^fe[89ab][0-9a-f]:/.test(host)) return 'That address is not allowed.';
  // An IPv6 form that carries the metadata range: Node writes `[::ffff:169.254.169.254]` as `::ffff:a9fe:a9fe`, so the dotted form alone is not enough.
  const inner = embeddedV4(host);
  if (inner && inner[0] === 169 && inner[1] === 254) return 'That address is not allowed.';
  return null;
}
