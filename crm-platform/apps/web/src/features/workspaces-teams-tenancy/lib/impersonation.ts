/** Whole minutes left, rounded down: 0 means under a minute (the banner then says so) or over. */
export function minutesLeft(expiresAt: string | null, now = Date.now()): number {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime() - now;
  return ms <= 0 ? 0 : Math.floor(ms / 60_000);
}

/** The path the stop route may send the browser to: same-site only, whatever the API said. */
export function consolePathFrom(returnUrl: unknown, fallback = '/admin/workspaces'): string {
  if (typeof returnUrl !== 'string') return fallback;
  try {
    const u = new URL(returnUrl, 'http://placeholder.invalid');
    return u.pathname.startsWith('/') && !u.pathname.startsWith('//') ? u.pathname : fallback;
  } catch {
    return fallback;
  }
}
