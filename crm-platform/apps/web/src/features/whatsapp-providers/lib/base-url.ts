import { checkProviderBaseUrl } from '@crm/contracts';

/** Why an address is refused, as a code the screen can say in the operator's language. */
export type BaseUrlProblem =
  | 'empty'
  | 'length'
  | 'characters'
  | 'invalid'
  | 'credentials'
  | 'queryOrFragment'
  | 'notHttps'
  | 'port'
  | 'host'
  | 'internal';

/** The contract's refusals, by the start of their text. A test proves every reason the contract can give lands on a code. */
const REASONS: ReadonlyArray<readonly [string, BaseUrlProblem]> = [
  ['The address must be between', 'length'],
  ['The address must not contain spaces', 'characters'],
  ['The address is not a valid URL', 'invalid'],
  ['The address must not contain credentials', 'credentials'],
  ['The address must not contain a query', 'queryOrFragment'],
  ['The address must start with https', 'notHttps'],
  ['Only the default https port', 'port'],
  ['The address must use a public host name, not an IP', 'host'],
  ['The address must use a public host name, not an internal', 'internal'],
];

export interface BaseUrlCheck {
  ok: boolean;
  /** The normalised address (no trailing slash, lower-case host) when ok. */
  url?: string;
  problem?: BaseUrlProblem;
  /** Plain `http` on a loopback host: the contract tolerates it, the API only outside production behind a flag. */
  devLoopback?: boolean;
}

/**
 * The shape half of the address rule, same as the API's first check. Whether the name resolves to public addresses only is the API's
 * call (it answers 422 `WAP_BASE_URL_REFUSED`), so a green tick here is not a promise.
 */
export function checkBaseUrl(raw: string): BaseUrlCheck {
  if (raw.trim() === '') return { ok: false, problem: 'empty' };
  const verdict = checkProviderBaseUrl(raw, { allowDevLoopback: true });
  if (verdict.ok) return { ok: true, url: verdict.url, devLoopback: verdict.devLoopback };
  const hit = REASONS.find(([start]) => verdict.reason.startsWith(start));
  return { ok: false, problem: hit?.[1] ?? 'invalid' };
}

/** `https://host/prefix/v25.0/me`: the address a live test or a call goes to. Null while the address is not valid. */
export function previewUrl(baseUrl: string, apiVersion: string, path = '/me'): string | null {
  const check = checkBaseUrl(baseUrl);
  if (!check.ok || !check.url) return null;
  const version = apiVersion.trim().replace(/^\/+|\/+$/g, '');
  const tail = path.startsWith('/') ? path : `/${path}`;
  return `${check.url}${version ? `/${version}` : ''}${tail}`;
}

const API_VERSION = /^v\d{1,2}(\.\d{1,2})?$/;
export const isApiVersion = (v: string): boolean => API_VERSION.test(v.trim());
