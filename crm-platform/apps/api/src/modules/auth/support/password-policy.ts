import type { SecurityPolicy } from '@crm/contracts';

export type PasswordRule = 'min_length' | 'upper_lower' | 'number' | 'symbol' | 'common';

export interface PasswordViolation {
  rule: PasswordRule;
  message: string;
}

/**
 * A small deny-list of the passwords that account for a large share of
 * credential-stuffing hits. Not a breach database; it exists so that the
 * policy cannot be satisfied by "Password1".
 */
const COMMON = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwertyuiop',
  'qwerty123',
  'iloveyou',
  'admin123',
  'welcome1',
  'letmein1',
  'passw0rd',
  'passw0rd!',
]);

export interface PasswordContext {
  email?: string;
  fullName?: string;
  /** Request field the password arrived in; the error path becomes `<field>.<rule>`. */
  field?: string;
}

/**
 * Pure evaluation of the admin password policy (TW-AUTH-035). Reference applied it
 * only on change-password; every path that sets a password calls this one.
 */
export function evaluatePassword(
  password: string,
  policy: Pick<
    SecurityPolicy,
    'passwordMinLength' | 'passwordRequireUpper' | 'passwordRequireNumber' | 'passwordRequireSymbol'
  >,
  context: PasswordContext = {},
): PasswordViolation[] {
  const out: PasswordViolation[] = [];
  const min = Math.max(6, policy.passwordMinLength);

  // Rules are Unicode-aware, as Laravel's `Password` rule is (TW-AUTH-035): length counts
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

  const lower = password.toLowerCase();
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (COMMON.has(lower) || (local && local.length >= 4 && lower.includes(local))) {
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
  // No timestamp once a policy exists: treat as stale, as Reference's isStale does.
  if (!changedAt) return true;
  return now.getTime() - changedAt.getTime() > maxAgeDays * 86_400_000;
}
