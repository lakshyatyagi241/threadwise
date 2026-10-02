/**
 * `?next=` after operator sign-in. Only a path inside the console is honoured, so the
 * sign-in page can never be turned into an open redirect.
 */
export function safeConsolePath(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!/^\/admin(?:\/[\w\-./]*)?(?:\?[\w\-./=&%]*)?$/.test(value)) return fallback;
  if (value.includes('//') || value.includes('..') || value.startsWith('/admin/login'))
    return fallback;
  return value;
}

/**
 * Sign-in address for an operator whose session ended while a console page was open: the reason (expired, or idle
 * with the limit) and the console page they were on as `?next=`, like the server layout does on a page load. A page
 * outside the console, the console home and the sign-in page itself give a plain reason with no `next`.
 */
export function operatorLoginPath(
  current: string | null | undefined,
  opts: { idleMinutes?: number } = {},
): string {
  const params = new URLSearchParams();
  if (opts.idleMinutes && opts.idleMinutes > 0) {
    params.set('expired', 'idle');
    params.set('minutes', String(Math.floor(opts.idleMinutes)));
  } else {
    params.set('expired', '1');
  }
  const next = safeConsolePath(current, '/admin');
  if (next !== '/admin') params.set('next', next);
  return `/admin/login?${params.toString()}`;
}
