/**
 * Validates the endpoint an operator types for a self-hosted translation server (WD-I18N-026 port note).
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

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'metadata.google.internal' || host === 'metadata') {
    return 'That address is not allowed.';
  }
  // IPv4 link-local 169.254.0.0/16 and IPv6 link-local fe80::/10.
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return 'That address is not allowed.';
  if (/^fe[89ab][0-9a-f]:/.test(host)) return 'That address is not allowed.';
  // IPv4-mapped IPv6 pointing at the metadata range.
  if (/^::ffff:169\.254\./.test(host)) return 'That address is not allowed.';
  return null;
}
