import { ApiError } from '@/lib/api/errors';

/** The rules the API reports for AUTH_PASSWORD_POLICY, as the last segment of `<field>.<rule>`. */
export const POLICY_RULES = ['min_length', 'upper_lower', 'number', 'symbol', 'common'] as const;
export type PolicyRule = (typeof POLICY_RULES)[number];

export interface PolicyViolation {
  /** Null when the API sent a path without a rule we know: show the server text. */
  rule: PolicyRule | null;
  /** The server's own wording, the fallback for anything we cannot translate. */
  message: string;
  /** For `min_length`, the N parsed from "Use at least N characters." */
  count: number | null;
}

const isRule = (value: string): value is PolicyRule =>
  (POLICY_RULES as readonly string[]).includes(value);

/** N from "Use at least N characters.", or null when the wording is not that. */
export function minLengthFrom(message: string): number | null {
  const m = /(\d+)/.exec(message);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * One entry per broken rule. Paths are `<field>.<rule>` (`newPassword.min_length`);
 * an old-style bare path (`password`, `newPassword`) or an unknown rule comes
 * back with `rule: null`, so the page falls back to the server text.
 */
export function policyViolations(error: unknown, field = 'newPassword'): PolicyViolation[] {
  if (!(error instanceof ApiError)) return [];
  const out: PolicyViolation[] = [];
  const seen = new Set<string>();
  for (const entry of error.fieldErrors) {
    const [head, ...rest] = entry.path.split('.');
    const matchesField = head === field || (head === 'password' && rest.length === 0);
    if (!matchesField) continue;
    const suffix = rest.join('.');
    const rule = suffix && isRule(suffix) ? suffix : null;
    const key = rule ?? `text:${entry.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      rule,
      message: entry.message,
      count: rule === 'min_length' ? minLengthFrom(entry.message) : null,
    });
  }
  return out;
}

export type Requirement = 'mixedCase' | 'number' | 'symbol';

/** The character kinds the live policy asks for besides length, in the order the hint lists them. */
export function requirementsOf(policy: {
  requireMixedCase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
}): Requirement[] {
  const out: Requirement[] = [];
  if (policy.requireMixedCase) out.push('mixedCase');
  if (policy.requireNumber) out.push('number');
  if (policy.requireSymbol) out.push('symbol');
  return out;
}
