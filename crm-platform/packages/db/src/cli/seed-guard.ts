import { randomBytes } from 'node:crypto';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Why the development seed must not run, or null when it may. The seed creates accounts with known passwords, so it runs only when
 * explicitly allowed (ALLOW_DEV_SEED=1), never with NODE_ENV=production, and only against a database on this machine.
 */
export function seedRefusal(env: NodeJS.ProcessEnv, databaseUrl: string): string | null {
  if (env.ALLOW_DEV_SEED !== '1') {
    return 'the development seed runs only with ALLOW_DEV_SEED=1 (it creates accounts with known passwords)';
  }
  if (env.NODE_ENV === 'production') return 'refusing to seed with NODE_ENV=production';
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return 'refusing to seed: cannot read the database host from the connection URL';
  }
  if (!LOCAL_HOSTS.has(host)) {
    return `refusing to seed a database on host "${host}": the seed runs only against localhost, 127.0.0.1 or ::1`;
  }
  return null;
}

/**
 * The password the seeded accounts get: DEV_SEED_PASSWORD when the developer sets one (the e2e and tooling fixtures read the same
 * variable), otherwise a fresh random password printed once by the seed. The old shared public password is never used.
 */
export function devSeedPassword(env: NodeJS.ProcessEnv = process.env): string {
  const chosen = env.DEV_SEED_PASSWORD;
  if (chosen && chosen.length >= 12) return chosen;
  return randomBytes(18).toString('base64url');
}
