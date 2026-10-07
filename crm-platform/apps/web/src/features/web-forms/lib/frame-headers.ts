/**
 * Who may frame a form page (spec section 7.3). The API computes the policy per form (`PublicForm.frameAncestors`: `'none'` for the
 * hosted page, the form's allowed origins for `?embed=1`) so the web app never decides what may frame a form; this file only asks for
 * it, checks that it is a well-formed source list, and turns it into the response headers. Everything else in the app keeps the
 * blanket `frame-ancestors 'self'` of `next.config.ts`, which exempts only `/f/*` and the chat widget.
 * Fail closed: an unreachable API, an unknown key, or a value that is not a clean source list all mean nobody frames it.
 */

const FORM_PATH = /^\/f\/([A-Za-z0-9_-]{16,64})(?:\/|$)/;
/** One CSP source as `frame-ancestors` takes it: a keyword, or scheme, host (optionally one leading `*.`) and port. No paths, no spaces. */
const SOURCE =
  /^(?:'none'|'self'|https?:\/\/(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?)$/;

export const formKeyOf = (pathname: string): string | null => FORM_PATH.exec(pathname)?.[1] ?? null;

export interface FrameAncestors {
  hosted: string;
  embed: string;
}

/** A source list the policy may carry: every token valid, and `'none'` never mixed with others. Otherwise `'none'`. */
export function cleanAncestors(value: string | undefined | null): string {
  const tokens = (value ?? '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || !tokens.every((t) => SOURCE.test(t))) return "'none'";
  if (tokens.includes("'none'")) return "'none'";
  return [...new Set(tokens)].join(' ');
}

export function frameHeaders(
  embed: boolean,
  ancestors: FrameAncestors | null,
): Record<string, string> {
  // The hosted page is never framed by anyone else, whatever the API says: that is the clickjacking rule.
  const value = embed && ancestors ? cleanAncestors(ancestors.embed) : "'none'";
  const headers: Record<string, string> = { 'Content-Security-Policy': `frame-ancestors ${value}` };
  // X-Frame-Options cannot express a list, so it is sent only when nobody may frame the page.
  if (value === "'none'") headers['X-Frame-Options'] = 'DENY';
  return headers;
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: FrameAncestors | null }>();

/** The frame policy of a published form from its public definition, cached for 30 seconds per key. */
export async function frameAncestorsFor(
  key: string,
  apiBase: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<FrameAncestors | null> {
  const hit = cache.get(key);
  if (hit && now() - hit.at < TTL_MS) return hit.value;
  let value: FrameAncestors | null = null;
  try {
    const res = await fetchImpl(`${apiBase}/v2/public/forms/${encodeURIComponent(key)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const body = (await res.json()) as { frameAncestors?: Partial<FrameAncestors> };
      const fa = body.frameAncestors;
      if (fa && typeof fa.embed === 'string')
        value = { hosted: typeof fa.hosted === 'string' ? fa.hosted : "'none'", embed: fa.embed };
    }
  } catch {
    value = null;
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: now(), value });
  return value;
}

export function resetFrameCache(): void {
  cache.clear();
}
