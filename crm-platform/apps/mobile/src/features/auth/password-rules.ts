import type { PasswordPolicyHint } from '@crm/contracts';

/**
 * What the platform's password policy asks for, shown as a live checklist while the person types. The server decides (and
 * reports `AUTH_PASSWORD_POLICY` with the broken rules); this only helps people get it right the first time. The checks mirror
 * the server's own (`apps/api/.../support/password-policy.ts`): letter case, a number and a symbol are Unicode-aware.
 */
export type PasswordRuleId = 'minLength' | 'mixedCase' | 'number' | 'symbol';

export interface PolicyParts {
  min: number;
  mixedCase: boolean;
  number: boolean;
  symbol: boolean;
}

/** The platform's smallest minimum, used only when the policy could not be read (the server still enforces the real one). */
export const DEFAULT_MIN_LENGTH = 8;

export function policyParts(policy: PasswordPolicyHint | null | undefined): PolicyParts {
  if (!policy) return { min: DEFAULT_MIN_LENGTH, mixedCase: false, number: false, symbol: false };
  return {
    min: policy.minLength,
    mixedCase: policy.requireMixedCase,
    number: policy.requireNumber,
    symbol: policy.requireSymbol,
  };
}

export interface PasswordRuleState {
  id: PasswordRuleId;
  met: boolean;
}

/** The rules in force, in the order they are listed, each with whether the password meets it right now. */
export function checkPassword(password: string, parts: PolicyParts): PasswordRuleState[] {
  const rules: PasswordRuleState[] = [{ id: 'minLength', met: password.length >= parts.min }];
  if (parts.mixedCase) {
    rules.push({ id: 'mixedCase', met: /\p{Ll}/u.test(password) && /\p{Lu}/u.test(password) });
  }
  if (parts.number) rules.push({ id: 'number', met: /\p{N}/u.test(password) });
  if (parts.symbol) rules.push({ id: 'symbol', met: /[\p{Z}\p{S}\p{P}]/u.test(password) });
  return rules;
}
