import type { PasswordPolicyHint } from '@crm/contracts';

/** What the admin's password policy asks for, in the order the hint lists it. */
export type PolicyExtra = 'mixedCase' | 'number' | 'symbol';

export interface PolicyHintParts {
  /** The live minimum length. */
  min: number;
  /** Extra rules in force (mixed case, a number, a symbol). */
  extras: PolicyExtra[];
}

/** The platform default, used only when the policy could not be read. */
export const DEFAULT_MIN_LENGTH = 8;

/**
 * Turns the public policy (`GET /v2/auth/password-policy`) into what a hint under a new-password field shows.
 * With no policy (API unreachable) the hint falls back to the default minimum and lists no extras; the server
 * still enforces the real rules on submit.
 */
export function policyHintParts(policy: PasswordPolicyHint | null | undefined): PolicyHintParts {
  if (!policy) return { min: DEFAULT_MIN_LENGTH, extras: [] };
  const extras: PolicyExtra[] = [];
  if (policy.requireMixedCase) extras.push('mixedCase');
  if (policy.requireNumber) extras.push('number');
  if (policy.requireSymbol) extras.push('symbol');
  return { min: policy.minLength, extras };
}

/** Whether a password is long enough for the live minimum (the other rules are the server's call). */
export function longEnough(password: string, parts: Pick<PolicyHintParts, 'min'>): boolean {
  return password.length >= parts.min;
}
