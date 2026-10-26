/**
 * The value of Express's `trust proxy` setting for a `TRUST_PROXY` string: a hop count (`1`), a comma-separated list
 * (`loopback,linklocal,uniquelocal`), or one name or address. The client address behind every per-address limit, lockout and
 * allow-list comes from this, so it is a function of its own and tested.
 */
export function parseTrustProxy(trust: string): number | string | string[] {
  if (/^\d+$/.test(trust)) return Number(trust);
  return trust.includes(',') ? trust.split(',').map((s) => s.trim()) : trust;
}
