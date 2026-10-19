/** A join address that is safe to link: http or https only, as written. Anything else (a script, a relative path) is not a link. */
export function safeHref(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(v)) return null;
  try {
    const url = new URL(v);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
