/**
 * Admin-edited links and media addresses end up in `href` / `src`. Only http(s) URLs and same-site paths are
 * allowed through, so a stored `javascript:` or `data:` value can never become active content.
 */
export function safeUrl(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^\/(?![/\\])/.test(v)) return v;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
