import { isLegalSlug, type LegalSlug } from '@crm/contracts';

/**
 * The Terms and Privacy addresses are edited by an administrator (and default to site paths such as "/legal/terms"). Only an
 * `https` address, or a site path that can be joined to the web app's address, becomes a link; anything else stays plain text: a
 * `javascript:` value, a path when the web address is not configured, and plain `http` (allowed only when `allowHttp` says the app
 * is a development build talking to a machine on the local network).
 */
export function resolveLegalUrl(
  value: string | null | undefined,
  webUrl: string | undefined,
  options: { allowHttp?: boolean } = {},
): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  let url: string | null = null;
  if (/^\/(?![/\\])/.test(v)) url = webUrl ? `${webUrl}${v}` : null;
  else if (/^https?:\/\/[^\s]+$/i.test(v)) url = v;
  if (!url) return null;
  return /^https:\/\//i.test(url) || options.allowHttp ? url : null;
}

/**
 * The legal document the app can show on its own screen for an address an administrator set: a blank value (the platform default),
 * a site path such as `/legal/terms`, or the same path on the web app's own address. Any other address (a company's own page) is
 * not one of ours and returns null, so it opens in the browser as before.
 */
export function legalSlugOf(
  value: string | null | undefined,
  webUrl: string | undefined,
): LegalSlug | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  let path: string | null = null;
  if (/^\/(?![/\\])/.test(v)) path = v;
  else if (webUrl && /^https?:\/\/[^\s]+$/i.test(v)) {
    try {
      const url = new URL(v);
      if (url.origin === new URL(webUrl).origin) path = url.pathname;
    } catch {
      return null;
    }
  }
  const slug = /^\/legal\/([a-z-]+)\/?(?:[?#].*)?$/.exec(path ?? '')?.[1];
  return slug && isLegalSlug(slug) ? slug : null;
}
