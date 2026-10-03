/**
 * True when the browser says the call comes from this site: Fetch Metadata does not say cross-site, and Origin (when sent) is the
 * host the request was addressed to. A custom domain works because both are the custom domain.
 */
export function isSameOrigin(headers: { get(name: string): string | null }): boolean {
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = headers.get('origin');
  if (!origin) return true;
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}
