import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import {
  ERROR_CODES,
  currencyExponent,
  majorToMinor,
  minorToMajor,
  type AppointmentStatus,
  type BookingDepositMode,
  type BookingQuestionType,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

export const APPOINTMENT_MODULE = 'appointments';
export const BOOKING_TYPE_MODULE = 'booking_types';

/** How long an unpaid pending booking holds its slot (D-13). */
export const PAYMENT_HOLD_MINUTES = 30;
/** Soft-lock reservation life (WaDesk: ten minutes). */
export const RESERVATION_MINUTES = 10;
/** A confirmed booking that ended this long ago with no verdict is flagged for review (WaDesk: 15 minutes). */
export const REVIEW_AFTER_MINUTES = 15;

// --- status machine (EXT-APPT-04, D-04) ---------------------------------------------------------------------------------------

const NEXT: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  pending: ['confirmed', 'declined', 'cancelled'],
  confirmed: ['cancelled', 'completed', 'no_show'],
  cancelled: [],
  declined: [],
  completed: [],
  no_show: [],
};

export const isActive = (s: AppointmentStatus): boolean => s === 'pending' || s === 'confirmed';
export const isFinal = (s: AppointmentStatus): boolean => NEXT[s].length === 0;
export const canMove = (from: AppointmentStatus, to: AppointmentStatus): boolean =>
  NEXT[from].includes(to);

export function assertTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (canMove(from, to)) return;
  throw new AppError(
    ERROR_CODES.APPT_INVALID_TRANSITION,
    `An appointment that is ${from.replace('_', '-')} cannot become ${to.replace('_', '-')}.`,
    HttpStatus.CONFLICT,
    [
      { path: 'from', message: from },
      { path: 'to', message: to },
    ],
  );
}

/** An action that only makes sense on a booking that still holds its slot (reschedule, payment, check-in). */
export function assertActive(status: AppointmentStatus, action: string): void {
  if (isActive(status)) return;
  throw new AppError(
    ERROR_CODES.APPT_INVALID_TRANSITION,
    `An appointment that is ${status.replace('_', '-')} cannot be changed any more.`,
    HttpStatus.CONFLICT,
    [
      { path: 'from', message: status },
      { path: 'to', message: action },
    ],
  );
}

// --- money (D-11) -------------------------------------------------------------------------------------------------------------

export interface PricingInput {
  currency: string | null;
  fee: string;
  taxPercent: string;
  depositMode: BookingDepositMode;
  deposit: string;
  cancelFee: string;
  noShowFee: string;
}

export interface PricingMinor {
  currency: string | null;
  feeMinor: bigint;
  taxBp: number;
  depositMinor: bigint;
  cancelFeeMinor: bigint;
  noShowFeeMinor: bigint;
  /** fee + tax. */
  totalMinor: bigint;
  /** What is owed to book. */
  dueNowMinor: bigint;
}

/** `"12.5"` -> 1250 basis points. */
export function percentToBp(percent: string): number {
  const [whole = '0', frac = ''] = percent.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

/** Tax rounded half up to the minor unit. */
export function totalWithTax(feeMinor: bigint, taxBp: number): bigint {
  const tax = (feeMinor * BigInt(taxBp) + 5_000n) / 10_000n;
  return feeMinor + tax;
}

const invalidAmount = (path: string, currency: string | null): AppError =>
  new AppError(
    ERROR_CODES.APPT_AMOUNT_INVALID,
    `An amount has at most ${currencyExponent(currency ?? 'USD')} decimals in ${currency ?? 'this currency'}.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path, message: 'amount' }],
  );

/** Converts the wire amounts (decimal strings) to minor units for the currency; 422 when one has too many decimals. */
export function priceInMinor(p: PricingInput): PricingMinor {
  const cur = p.currency ?? 'USD';
  const minor = (v: string, path: string): bigint => {
    const m = majorToMinor(v, cur);
    if (m === null) throw invalidAmount(path, p.currency);
    return m;
  };
  const feeMinor = minor(p.fee, 'payment.fee');
  const depositMinor = minor(p.deposit, 'payment.deposit');
  const taxBp = percentToBp(p.taxPercent);
  const totalMinor = totalWithTax(feeMinor, taxBp);
  if (p.depositMode === 'partial' && depositMinor > totalMinor) {
    throw new AppError(
      ERROR_CODES.APPT_AMOUNT_INVALID,
      'A partial deposit cannot be more than the price.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'payment.deposit', message: 'deposit_exceeds_total' }],
    );
  }
  const dueNowMinor =
    p.depositMode === 'full' ? totalMinor : p.depositMode === 'partial' ? depositMinor : 0n;
  return {
    currency: p.currency,
    feeMinor,
    taxBp,
    depositMinor,
    cancelFeeMinor: minor(p.cancelFee, 'payment.cancelFee'),
    noShowFeeMinor: minor(p.noShowFee, 'payment.noShowFee'),
    totalMinor,
    dueNowMinor,
  };
}

/** Minor units to the wire's decimal string; a null currency prints with two decimals. */
export const money = (minor: bigint | number | string, currency: string | null): string =>
  minorToMajor(minor, currency ?? 'USD');

// --- slugs and tokens ---------------------------------------------------------------------------------------------------------

export function slugify(input: string): string {
  const s = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return s || `type-${randomBytes(3).toString('hex')}`;
}

/** 256 random bits, base64url: 43 characters, unguessable. Only its SHA-256 is looked up. */
export const generateManageToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');
export const looksLikeToken = (raw: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(raw);

// --- answers (D-15) -----------------------------------------------------------------------------------------------------------

export interface QuestionFacts {
  id: string;
  label: string;
  type: BookingQuestionType;
  options: string[] | null;
  required: boolean;
  mapToContactField: 'name' | 'email' | 'phone' | null;
}

export interface AnswerSnapshot {
  questionId: string | null;
  label: string;
  type: BookingQuestionType;
  value: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function problem(
  type: BookingQuestionType,
  value: string,
  options: string[] | null,
): string | null {
  switch (type) {
    case 'email':
      return EMAIL.test(value) ? null : 'must be an email address';
    case 'number':
      return /^-?\d+(\.\d+)?$/.test(value) ? null : 'must be a number';
    case 'phone':
      return value.replace(/\D/g, '').length >= 5 ? null : 'must be a phone number';
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'must be a date (YYYY-MM-DD)';
      const d = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
        ? null
        : 'must be a real date';
    }
    case 'select':
      return options?.includes(value) ? null : 'must be one of the choices';
    default:
      return null;
  }
}

/**
 * Checks the answers against the type's questions: unknown ids, missing required answers, wrong format, a choice that is not offered.
 * Returns the snapshots to store (the label and type travel with the value, so renaming a question later does not orphan history).
 */
export function checkAnswers(
  questions: QuestionFacts[],
  given: Record<string, string> | undefined,
): AnswerSnapshot[] {
  const answers = given ?? {};
  const issues: Array<{ path: string; message: string }> = [];
  const known = new Set(questions.map((q) => q.id));
  for (const id of Object.keys(answers)) {
    if (!known.has(id))
      issues.push({ path: `answers.${id}`, message: 'not a question of this service' });
  }
  const out: AnswerSnapshot[] = [];
  for (const q of questions) {
    const value = (answers[q.id] ?? '').trim();
    if (value === '') {
      if (q.required) issues.push({ path: `answers.${q.id}`, message: `${q.label}: required` });
      continue;
    }
    const bad = problem(q.type, value, q.options);
    if (bad) issues.push({ path: `answers.${q.id}`, message: `${q.label}: ${bad}` });
    out.push({ questionId: q.id, label: q.label, type: q.type, value });
  }
  if (issues.length > 0) {
    throw new AppError(
      ERROR_CODES.APPT_ANSWERS_INVALID,
      'Some answers are missing or not valid.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      issues,
    );
  }
  return out;
}

/** The invitee fields the answers fill when the invitee did not give them (WaDesk mapped answers onto empty contact fields). */
export function inviteeFromAnswers(
  questions: QuestionFacts[],
  answers: AnswerSnapshot[],
): { name?: string; email?: string; phone?: string } {
  const out: { name?: string; email?: string; phone?: string } = {};
  for (const q of questions) {
    if (!q.mapToContactField) continue;
    const a = answers.find((x) => x.questionId === q.id);
    if (a && out[q.mapToContactField] === undefined) out[q.mapToContactField] = a.value;
  }
  return out;
}
