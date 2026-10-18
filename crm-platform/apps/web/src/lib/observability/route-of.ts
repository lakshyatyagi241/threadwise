/**
 * The `route` label for a request to the Next.js server (EL-B20). Next does not tell the HTTP layer which route file handled a request,
 * so this derives a low-cardinality template from the URL: dynamic-looking segments become `:id`, long paths are cut at four segments,
 * Next's own asset URLs are folded, and every 404 is `unmatched` (a scanner probing random URLs must not create series: the histogram
 * folds past 500 label sets, and the real routes would be the ones pushed into "overflow").
 *
 * The metrics listener's own requests (`/metrics`) are not measured.
 */

/**
 * A segment that is a value, not a route name: anything with a digit in it (route names do not have digits; `v2`-style version prefixes
 * are kept), a UUID, a long hex string, a long token with no hyphen (route names are kebab-case words).
 */
const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,}|(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{12,})$/i;

const MAX_SEGMENTS = 4;

const isValue = (segment: string): boolean =>
  (/\d/.test(segment) && !/^v\d+$/i.test(segment)) ||
  ID_SEGMENT.test(segment) ||
  (!segment.includes('-') && segment.length > 16);

export function webRouteOf(
  req: { method: string; url: string },
  statusCode: number,
): string | null {
  const q = req.url.indexOf('?');
  const path = q === -1 ? req.url : req.url.slice(0, q);
  if (path === '/metrics') return null;
  if (statusCode === 404) return 'unmatched';
  if (path.startsWith('/_next/static/')) return '/_next/static/*';
  if (path.startsWith('/_next/image')) return '/_next/image';
  if (path.startsWith('/_next/data/')) return '/_next/data/*';
  if (path.startsWith('/_next/')) return '/_next/*';
  let segments: string[];
  try {
    segments = path.split('/').filter((s) => s !== '');
  } catch {
    return 'unmatched';
  }
  if (segments.length === 0) return '/';
  const kept = segments
    .slice(0, MAX_SEGMENTS)
    .map((s) => (isValue(decodeSafe(s)) ? ':id' : decodeSafe(s)));
  // A segment name is a route name only if it is short and plain; anything else is a value.
  const plain = kept.map((s) => (s.length > 40 || /[^A-Za-z0-9._\-:~()@]/.test(s) ? ':id' : s));
  return `/${plain.join('/')}${segments.length > MAX_SEGMENTS ? '/*' : ''}`;
}

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
