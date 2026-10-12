/**
 * The syntactic half of the base-URL rule. A provider's base URL is typed by an operator and every outbound WhatsApp call, with its
 * credential, goes to it, so it must not be a way to reach the platform's own network: https only, a public DNS name (never an IP
 * literal, `localhost` or an internal suffix), the default port, no credentials, query or fragment.
 *
 * The API adds the half a URL cannot show: the name must RESOLVE to public addresses only (checked when it is saved and again on every
 * call, at the moment of connection). Plain http on a loopback host is accepted only when the caller says it is a development
 * environment (`allowDevLoopback`), which the API grants only outside production and only behind an explicit flag.
 */

/** The WHATWG URL class: a global in Node and every browser; this package's tsconfig carries no DOM or Node typings, so the slice used is declared here. */
declare const URL: new (input: string) => {
  protocol: string;
  username: string;
  password: string;
  search: string;
  hash: string;
  hostname: string;
  port: string;
  host: string;
  pathname: string;
};

export const MAX_BASE_URL_LENGTH = 200;

const DNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const INTERNAL_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.intranet',
  '.private',
  '.test',
  '.example',
  '.invalid',
  '.home.arpa',
  '.svc',
  '.cluster.local',
];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type BaseUrlVerdict =
  { ok: true; url: string; host: string; devLoopback: boolean } | { ok: false; reason: string };

/** Returns the normalised URL (no trailing slash, lower-case host) or the reason it is refused. */
export function checkProviderBaseUrl(
  raw: string,
  options: { allowDevLoopback?: boolean } = {},
): BaseUrlVerdict {
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_BASE_URL_LENGTH) {
    return {
      ok: false,
      reason: `The address must be between 1 and ${MAX_BASE_URL_LENGTH} characters`,
    };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(text))
    return { ok: false, reason: 'The address must not contain spaces or control characters' };
  let url: InstanceType<typeof URL>;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: 'The address is not a valid URL' };
  }
  if (url.username !== '' || url.password !== '')
    return { ok: false, reason: 'The address must not contain credentials' };
  if (url.search !== '' || url.hash !== '')
    return { ok: false, reason: 'The address must not contain a query or a fragment' };

  const host = url.hostname.toLowerCase();
  if (options.allowDevLoopback && url.protocol === 'http:' && LOOPBACK_HOSTS.has(host)) {
    return { ok: true, url: normalise(url), host, devLoopback: true };
  }
  if (url.protocol !== 'https:')
    return { ok: false, reason: 'The address must start with https://' };
  if (url.port !== '' && url.port !== '443')
    return { ok: false, reason: 'Only the default https port is allowed' };
  if (!DNS_NAME.test(host)) {
    return {
      ok: false,
      reason: 'The address must use a public host name, not an IP address or a single-label name',
    };
  }
  if (INTERNAL_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s))) {
    return { ok: false, reason: 'The address must use a public host name, not an internal one' };
  }
  return { ok: true, url: normalise(url), host, devLoopback: false };
}

function normalise(url: { protocol: string; host: string; pathname: string }): string {
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}
