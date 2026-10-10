import { createHash } from 'node:crypto';

/**
 * Online layer of the password blocklist: Have I Been Pwned "Pwned Passwords", range API (k-anonymity).
 *
 * Only the first five hex characters of the password's SHA-1 leave the server; the full hash and the password never
 * do. `Add-Padding` makes every response the same size so even the response length reveals nothing. A password found
 * in the list is refused; ANY failure (timeout, offline, 5xx) answers "unknown" and the caller lets the password
 * through: a breach lookup must never stop a person from setting a password, and the offline blocklist still applies.
 * After a failure the lookup is skipped for a minute so a blocked network costs one timeout, not one per sign-up.
 */
export type BreachVerdict = 'breached' | 'clean' | 'unknown';

const DEFAULT_ENDPOINT = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 1500;
const BACKOFF_MS = 60_000;

let skipUntil = 0;

export interface BreachCheckOptions {
  /** Override for tests and air-gapped installs. An empty string disables the check. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export async function checkPwnedPassword(
  password: string,
  options: BreachCheckOptions = {},
): Promise<BreachVerdict> {
  const endpoint = options.endpoint ?? process.env.PASSWORD_BREACH_CHECK_URL ?? DEFAULT_ENDPOINT;
  if (!endpoint) return 'unknown';
  const now = options.now ?? Date.now;
  if (now() < skipUntil) return 'unknown';

  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await (options.fetchImpl ?? fetch)(`${endpoint}${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'crm-platform-password-check' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`pwned passwords answered ${res.status}`);
    const body = await res.text();
    for (const line of body.split(/\r?\n/)) {
      const [hash, count] = line.trim().split(':');
      // Padding rows carry a count of 0 and are not matches.
      if (hash === suffix && Number(count) > 0) return 'breached';
    }
    return 'clean';
  } catch {
    skipUntil = now() + BACKOFF_MS;
    return 'unknown';
  }
}

/** Test hook: forget a previous failure. */
export function resetBreachCheckBackoff(): void {
  skipUntil = 0;
}
