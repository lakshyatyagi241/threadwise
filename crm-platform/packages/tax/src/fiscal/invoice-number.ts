import type { FiscalYearConfig, NumberingRules, SequenceReset } from '../profiles/types';
import { isIsoDate } from '../profiles/utils';
import { fiscalYearOf } from './fiscal-year';

/**
 * Invoice-number helpers: a pattern with tokens, a counter that resets by policy, and a validator for the legal limits of a
 * country (India: at most 16 characters, letters, digits, "-" and "/" only, unique per financial year).
 *
 * Tokens: {PREFIX} {FY} (fiscal-year label) {YYYY} {YY} {MM} {SEQ} (zero-padded counter).
 */

export interface NumberFormatInput {
  /** Defaults to the rules' pattern. */
  pattern?: string;
  prefix: string;
  seq: number;
  /** Issue date (ISO). */
  date: string;
  fiscalYear: FiscalYearConfig;
  seqPad?: number;
}

export function formatInvoiceNumber(i: NumberFormatInput): string {
  if (!isIsoDate(i.date)) throw new RangeError(`"${i.date}" is not an ISO date (YYYY-MM-DD)`);
  if (!Number.isInteger(i.seq) || i.seq < 0)
    throw new RangeError('seq must be a non-negative integer');
  const fy = fiscalYearOf(i.date, i.fiscalYear);
  const tokens: Record<string, string> = {
    PREFIX: i.prefix,
    FY: fy.label,
    YYYY: i.date.slice(0, 4),
    YY: i.date.slice(2, 4),
    MM: i.date.slice(5, 7),
    SEQ: String(i.seq).padStart(i.seqPad ?? 4, '0'),
  };
  return (i.pattern ?? '{PREFIX}-{YYYY}-{SEQ}').replace(
    /\{([A-Z]+)\}/g,
    (_, k: string) => tokens[k] ?? `{${k}}`,
  );
}

/** The counter scope a date falls in: documents in the same scope share one running sequence. */
export function sequenceScope(
  date: string,
  reset: SequenceReset,
  fiscalYear: FiscalYearConfig,
): string {
  if (!isIsoDate(date)) throw new RangeError(`"${date}" is not an ISO date (YYYY-MM-DD)`);
  switch (reset) {
    case 'never':
      return 'all';
    case 'yearly':
      return date.slice(0, 4);
    case 'monthly':
      return date.slice(0, 7);
    default:
      return `FY${fiscalYearOf(date, fiscalYear).label}`;
  }
}

export interface SequenceState {
  scope: string;
  /** The last number issued in `scope`. */
  seq: number;
}

/** The next number for an issue date, resetting the counter when the scope changed. Persist the returned `state` atomically. */
export function nextInvoiceNumber(
  rules: NumberingRules,
  fiscalYear: FiscalYearConfig,
  input: { date: string; prefix?: string; state?: SequenceState | null; reset?: SequenceReset },
): { number: string; state: SequenceState } {
  const scope = sequenceScope(input.date, input.reset ?? rules.reset, fiscalYear);
  const seq = input.state && input.state.scope === scope ? input.state.seq + 1 : 1;
  const number = formatInvoiceNumber({
    pattern: rules.pattern,
    prefix: input.prefix ?? rules.defaultPrefix,
    seq,
    date: input.date,
    fiscalYear,
    seqPad: rules.seqPad,
  });
  return { number, state: { scope, seq } };
}

/** Checks a number against the country's legal limits (length, character set). */
export function validateInvoiceNumber(
  rules: NumberingRules,
  number: string,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (number.length === 0) issues.push('The invoice number is empty.');
  if (rules.maxLength !== undefined && number.length > rules.maxLength) {
    issues.push(
      `The invoice number may have at most ${rules.maxLength} characters (it has ${number.length}).`,
    );
  }
  if (rules.allowed && !new RegExp(rules.allowed).test(number)) {
    issues.push('The invoice number contains characters that are not allowed here.');
  }
  return { valid: issues.length === 0, issues };
}
