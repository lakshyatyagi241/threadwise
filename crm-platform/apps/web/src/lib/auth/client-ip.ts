import { isIP } from 'node:net';

/**
 * The visitor's address as the API should record it (lockout key, rate limits, operator IP
 * allowlist, audit rows).
 *
 * `X-Forwarded-For` is a list the client may start with anything it likes; each proxy appends the
 * address it saw. Only the entries appended by proxies we operate can be believed, so the address
 * is counted from the right: with `WEB_TRUSTED_PROXY_HOPS=N` proxies in front of this server, the
 * client is the Nth entry from the end. With 0 (the default) the header is never believed and
 * nothing is forwarded, so the API falls back to the address of this server.
 */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.WEB_TRUSTED_PROXY_HOPS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 0;
}

function bareAddress(raw: string): string {
  const v = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracketed) return bracketed[1] as string;
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(v);
  return v4WithPort ? (v4WithPort[1] as string) : v;
}

export function clientIpFrom(
  headers: { get(name: string): string | null },
  hops: number = trustedProxyHops(),
): string | null {
  if (hops <= 0) return null;
  const parts = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const entry = parts[parts.length - hops];
  if (!entry) return null;
  const ip = bareAddress(entry);
  return isIP(ip) ? ip : null;
}

/** Header to set on an upstream call, or an empty object when no address can be trusted. */
export function clientIpHeader(
  headers: { get(name: string): string | null },
  hops?: number,
): Record<string, string> {
  const ip = clientIpFrom(headers, hops);
  return ip ? { 'x-forwarded-for': ip } : {};
}
