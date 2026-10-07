import { normaliseFormOrigin } from '@crm/contracts';

/**
 * The embed allow-list (docs/specs/forms-builder-app.md 7.3). A list of exact origins (`https://example.com`, with the port when it is not
 * the default) or one wildcard level (`https://*.example.com`, which matches every subdomain and not the apex). Never a bare `*`.
 * An EMPTY list means the hosted page only: no embedding and no browser may post to the form from another origin.
 *
 * The check is for BROWSERS. A request with no `Origin` header (a script, a server, curl) cannot be refused by an allow-list and is not
 * (it is held by the rate limits, the CAPTCHA and the spam rules instead).
 */

export type OriginVerdict = 'skip' | 'allowed' | 'denied';

/** `origin` is the request's `Origin` header. `own` are origins that are always allowed (the web app's own origin). */
export function checkOrigin(
  origin: string | undefined,
  allowed: readonly string[],
  own: readonly string[] = [],
): OriginVerdict {
  if (!origin) return 'skip';
  const o = normaliseFormOrigin(origin);
  if (!o) return 'denied';
  if (own.some((x) => normaliseFormOrigin(x) === o)) return 'allowed';
  return allowed.some((entry) => originMatches(o, entry)) ? 'allowed' : 'denied';
}

function originMatches(origin: string, entry: string): boolean {
  if (origin === entry) return true;
  const star = /^(https?):\/\/\*\.(.+)$/.exec(entry);
  if (!star) return false;
  const scheme = star[1];
  const base = star[2];
  const m = /^(https?):\/\/([^:/]+)(?::(\d+))?$/.exec(origin);
  if (!m || m[1] !== scheme || !base) return false;
  // The wildcard carries the entry's port, if any: `https://*.example.com:8443` allows that port only.
  const entryHost = base.replace(/:\d+$/, '');
  const entryPort = /:(\d+)$/.exec(base)?.[1];
  const host = m[2] ?? '';
  return host.endsWith(`.${entryHost}`) && (entryPort ?? '') === (m[3] ?? '');
}

/** The `frame-ancestors` value for the form's page: nothing may frame the hosted page; an embed may be framed by the allow-list. */
export function frameAncestorsFor(allowed: readonly string[], embed: boolean): string {
  if (!embed || allowed.length === 0) return "'none'";
  // CSP sources are host expressions; the scheme-and-wildcard form of our entries is valid as it stands.
  return allowed.join(' ');
}
