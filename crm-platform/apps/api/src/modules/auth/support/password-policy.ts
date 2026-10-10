import type { SecurityPolicy } from '@crm/contracts';
import { COMMON_BASE_WORDS, COMMON_PASSWORDS, KEYBOARD_RUNS } from './common-passwords';

export type PasswordRule =
  'min_length' | 'upper_lower' | 'number' | 'symbol' | 'common' | 'breached';

export interface PasswordViolation {
  rule: PasswordRule;
  message: string;
}

/**
 * The shortest password the platform will ever accept, whatever an administrator configures. ASVS 5.0 requires at least
 * 8 characters; the platform default is longer (see the security policy contract).
 */
export const PASSWORD_LENGTH_FLOOR = 8;

export interface PasswordContext {
  email?: string;
  fullName?: string;
  /** Request field the password arrived in; the error path becomes `<field>.<rule>`. */
  field?: string;
}

/** Characters people swap for letters ("p@ssw0rd"). `1` can be i or l, so it is expanded into both. */
const LEET: Record<string, string> = {
  '@': 'a',
  '4': 'a',
  '8': 'b',
  '3': 'e',
  '!': 'i',
  '0': 'o',
  $: 's',
  '5': 's',
  '7': 't',
  '+': 't',
};

/** Undoes leet-speak on an already lower-cased, NFKC-folded string. Returns both readings of "1" (i or l). */
function deLeet(lower: string): string[] {
  const mapped = [...lower].map((c) => LEET[c] ?? c).join('');
  return [mapped.replace(/1/g, 'i'), mapped.replace(/1/g, 'l')];
}

/** "123Welcome!!" -> "welcome": digits and symbols at either end are decoration, not entropy. */
const stripDecoration = (s: string): string =>
  s.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '');

/**
 * Every reasonable reading of the "word" inside a password. Decoration is removed BEFORE leet-speak is undone (otherwise
 * a "!" at the end becomes an "i"), and again after (so "$ummer2024" and "P@ssw0rd#" both reduce to a dictionary word).
 */
function coreVariants(lower: string): Set<string> {
  const bases = new Set([
    stripDecoration(lower),
    lower.replace(/[^\p{L}]+$/u, ''),
    lower.replace(/^\d+/, '').replace(/\d+$/, ''),
  ]);
  const out = new Set<string>();
  for (const base of bases) {
    out.add(base);
    out.add(stripDecoration(base));
    for (const v of deLeet(base)) {
      out.add(v);
      out.add(stripDecoration(v));
    }
  }
  return out;
}

/**
 * True when most of the password is made of keyboard rows / alphabet / digit runs (or their reverse): "qwerty12345",
 * "zxcvbnmasdfgh", "1qaz2wsx3edc". Runs of 4+ are counted greedily left to right; the password is a walk when they cover
 * at least `ratio` of it.
 */
function isKeyboardWalk(lower: string, ratio = 0.7, minRun = 4): boolean {
  const chars = [...lower];
  if (chars.length < 8) return false;
  const seqs = KEYBOARD_RUNS.flatMap((run) => [run, [...run].reverse().join('')]);
  let covered = 0;
  let i = 0;
  while (i < chars.length) {
    let best = 0;
    for (const seq of seqs) {
      for (let j = 0; j < seq.length; j++) {
        let k = 0;
        while (i + k < chars.length && j + k < seq.length && chars[i + k] === seq[j + k]) k++;
        if (k > best) best = k;
      }
    }
    if (best >= minRun) {
      covered += best;
      i += best;
    } else {
      i += 1;
    }
  }
  return covered / chars.length >= ratio;
}

/** "aaaaaaaa", "abababab", "12341234": one to four characters repeated for the whole password. */
const isRepeated = (lower: string): boolean => /^(.{1,4})\1+$/su.test(lower);

/** Pure check against the offline blocklist (whole list, base words, walks, repeats, personal data). */
export function isCommonPassword(password: string, context: PasswordContext = {}): boolean {
  const lower = password.normalize('NFKC').toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  for (const core of coreVariants(lower)) {
    if (COMMON_PASSWORDS.has(core) || COMMON_BASE_WORDS.has(core)) return true;
  }
  if (isRepeated(lower) || isKeyboardWalk(lower)) return true;

  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return true;
  const nameParts = (context.fullName ?? '')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((p) => p.length >= 4);
  return nameParts.some((p) => lower.includes(p));
}

/**
 * Pure evaluation of the admin password policy (WD-AUTH-035). WaDesk applied it
 * only on change-password; every path that sets a password calls this one.
 * The online breach check (pwned-passwords.ts) is separate: it needs the network.
 */
export function evaluatePassword(
  password: string,
  policy: Pick<
    SecurityPolicy,
    'passwordMinLength' | 'passwordRequireUpper' | 'passwordRequireNumber' | 'passwordRequireSymbol'
  > &
    Partial<Pick<SecurityPolicy, 'passwordBlocklistEnabled'>>,
  context: PasswordContext = {},
): PasswordViolation[] {
  const out: PasswordViolation[] = [];
  const min = Math.max(PASSWORD_LENGTH_FLOOR, policy.passwordMinLength);

  // Rules are Unicode-aware, as Laravel's `Password` rule is (WD-AUTH-035): length counts
  // characters (an emoji or an accented letter is one), "mixed case" is any lower-case plus
  // any upper-case letter of ANY script, a number is any Unicode digit, and a symbol is
  // punctuation, a symbol or a space. ASCII-only classes would call "é" a symbol and refuse
  // every password written in Cyrillic or Greek as unmixed.
  if ([...password].length < min) {
    out.push({ rule: 'min_length', message: `Use at least ${min} characters.` });
  }
  if (policy.passwordRequireUpper && !(/\p{Ll}/u.test(password) && /\p{Lu}/u.test(password))) {
    out.push({ rule: 'upper_lower', message: 'Mix upper and lower case letters.' });
  }
  if (policy.passwordRequireNumber && !/\p{N}/u.test(password)) {
    out.push({ rule: 'number', message: 'Include at least one number.' });
  }
  if (policy.passwordRequireSymbol && !/[\p{Z}\p{S}\p{P}]/u.test(password)) {
    out.push({ rule: 'symbol', message: 'Include at least one symbol.' });
  }

  if (policy.passwordBlocklistEnabled !== false && isCommonPassword(password, context)) {
    out.push({ rule: 'common', message: 'That password is too easy to guess.' });
  }
  return out;
}

/** `password_changed_at` older than the policy's maximum age (0 = never). */
export function isPasswordStale(
  changedAt: Date | null,
  maxAgeDays: number,
  now: Date = new Date(),
): boolean {
  if (maxAgeDays <= 0) return false;
  // No timestamp once a policy exists: treat as stale, as WaDesk's isStale does.
  if (!changedAt) return true;
  return now.getTime() - changedAt.getTime() > maxAgeDays * 86_400_000;
}
