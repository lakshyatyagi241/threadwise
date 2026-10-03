/** Shown while NEXT_PUBLIC_API_PUBLIC_URL is not set, so a copied URL is obviously incomplete. */
export const API_URL_PLACEHOLDER = 'https://<your-api-domain>';

/** The public address of the API (what BSPs and Meta call back), without a trailing slash. Empty when not configured. */
export function apiPublicBase(
  raw: string | undefined | null = process.env.NEXT_PUBLIC_API_PUBLIC_URL,
): string {
  const v = (raw ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(v) ? v : '';
}

export interface WebhookUrl {
  /** The full URL to give the BSP or Meta. */
  url: string;
  /** False when the API's public address is not configured: the URL starts with a placeholder. */
  configured: boolean;
}

/** Provider keys are url segments: lower-case letters, digits and underscores. */
export const PROVIDER_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** `<api public url>/webhooks/whatsapp/<providerKey>`. Empty key gives a placeholder segment, never an empty one. */
export function webhookUrl(providerKey: string, base: string = apiPublicBase()): WebhookUrl {
  const key = providerKey.trim();
  const segment = PROVIDER_KEY_RE.test(key) ? key : '<providerKey>';
  const root = base || API_URL_PLACEHOLDER;
  return { url: `${root}/webhooks/whatsapp/${segment}`, configured: base !== '' };
}

/** `amped-express.interakt.ai`: the host of a base URL for the list, or the raw text when it is not a URL yet. */
export function baseHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export type BaseUrlIssue =
  'empty' | 'invalid' | 'notHttps' | 'hasQuery' | 'hasVersion' | 'trailingSlash';

/**
 * The base URL is the root every path hangs from: the version is its own field, so a version in the URL would be sent twice.
 * Plain http is accepted only for a loopback test server, as the API does.
 */
export function checkBaseUrl(raw: string): BaseUrlIssue | null {
  const v = raw.trim();
  if (!v) return 'empty';
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return 'invalid';
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return 'notHttps';
  if (u.search || u.hash) return 'hasQuery';
  if (/\/v\d+(\.\d+)?\/?$/.test(u.pathname)) return 'hasVersion';
  if (v.endsWith('/')) return 'trailingSlash';
  return null;
}

export const API_VERSION_RE = /^v\d+\.\d+$/;

/** `<baseUrl>/<apiVersion>/<path>` with exactly one slash between the parts. */
export function graphRoot(baseUrl: string, apiVersion: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/${apiVersion.trim()}`;
}
