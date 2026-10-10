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
