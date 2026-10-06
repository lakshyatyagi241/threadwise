/**
 * The visitor's relay (`/api/public/forms/*`) forwards to the API's public form routes WITHOUT any session cookie: a form's key
 * is its only identifier and a staff member filling a form in their own browser must not act as staff. What may be forwarded is a
 * short allowlist, matched here as a pure function: a method and the path segments after the relay's prefix. Anything else is a
 * 404 (no such path) or 405 (a path that exists, with another method). Segments are checked against strict patterns, so a
 * traversal (`..`), an encoded slash, a space or an extra segment never reaches the API.
 */

/** A form's public key: 22 random characters, URL-safe. A little slack either side so a key length change needs no web release. */
export const FORM_KEY = /^[A-Za-z0-9_-]{16,64}$/;
/** The token `submit` returns to follow one submission. */
export const SUBMISSION_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export type PublicPathMatch =
  | { ok: true; path: string; method: 'GET' | 'POST'; hasBody: boolean }
  | { ok: false; status: 404 | 405 };

interface Route {
  method: 'GET' | 'POST';
  shape: ReadonlyArray<RegExp | string>;
}

const ROUTES: readonly Route[] = [
  { method: 'GET', shape: [FORM_KEY] },
  { method: 'POST', shape: [FORM_KEY, 'events'] },
  { method: 'POST', shape: [FORM_KEY, 'submit'] },
  { method: 'GET', shape: [FORM_KEY, 'submissions', SUBMISSION_TOKEN] },
];

const fits = (shape: Route['shape'], segments: readonly string[]): boolean =>
  shape.length === segments.length &&
  shape.every((rule, i) =>
    typeof rule === 'string' ? rule === segments[i] : rule.test(segments[i]!),
  );

/** `HEAD` is read like `GET`. The result's `path` is under `/v2/public/forms/`, every segment encoded. */
export function matchPublicPath(method: string, segments: readonly string[]): PublicPathMatch {
  const verb = method === 'HEAD' ? 'GET' : method;
  const shaped = ROUTES.filter((r) => fits(r.shape, segments));
  if (shaped.length === 0) return { ok: false, status: 404 };
  const route = shaped.find((r) => r.method === verb);
  if (!route) return { ok: false, status: 405 };
  return {
    ok: true,
    path: segments.map(encodeURIComponent).join('/'),
    method: route.method,
    hasBody: route.method === 'POST',
  };
}
