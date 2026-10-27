/**
 * Decides whether a development seed may run. The seeds write well-known
 * passwords, so they run only when NODE_ENV is not production AND the database
 * host is this machine. Kept identical to apps/api/src/modules/auth/cli/dev-seed-guard.ts.
 *
 * Returns the refusal message, or null when the seed may run. Never returns the
 * URL itself, which carries a password.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function devSeedRefusal(env: { NODE_ENV?: string }, databaseUrl: string): string | null {
  if (env.NODE_ENV === 'production') return 'refusing to seed with NODE_ENV=production';
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return 'The database URL is not a valid URL.';
  }
  if (!LOCAL_HOSTS.has(host)) return `refusing to seed a non-local database host (${host})`;
  return null;
}
