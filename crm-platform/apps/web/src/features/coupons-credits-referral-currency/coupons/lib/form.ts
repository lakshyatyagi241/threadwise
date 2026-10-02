import {
  COUPON_LIMITS,
  createCouponRequestSchema,
  type Coupon,
  type CouponType,
  type CreateCouponRequest,
  type UpdateCouponRequest,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { trimDecimal } from './list';

/** A coupon as the form holds it: text for every field, dates as `datetime-local` values (browser-local time). */
export interface CouponDraft {
  code: string;
  description: string;
  adminNote: string;
  isActive: boolean;
  type: CouponType;
  amount: string;
  maxDiscountAmount: string;
  currencyCode: string;
  minOrderAmount: string;
  applicablePlanSlugs: string[];
  startsAt: string;
  expiresAt: string;
  maxUses: string;
  perUserLimit: string;
  firstPurchaseOnly: boolean;
  stackableWithOther: boolean;
}

export const FORM_FIELDS = [
  'code',
  'description',
  'adminNote',
  'type',
  'amount',
  'maxDiscountAmount',
  'currencyCode',
  'minOrderAmount',
  'applicablePlanSlugs',
  'startsAt',
  'expiresAt',
  'maxUses',
  'perUserLimit',
] as const;
export type FormField = (typeof FORM_FIELDS)[number];

export type ProblemKind =
  | 'required'
  | 'money'
  | 'count'
  | 'tooLong'
  | 'date'
  | 'window'
  | 'taken'
  | 'unknownPlan'
  | 'invalid';
export type CouponProblems = Partial<Record<FormField, ProblemKind>>;

/** Reference's defaults: Active ON, percent, First purchase only OFF, Stackable OFF. */
export const emptyCouponDraft = (): CouponDraft => ({
  code: '',
  description: '',
  adminNote: '',
  isActive: true,
  type: 'percent',
  amount: '',
  maxDiscountAmount: '',
  currencyCode: '',
  minOrderAmount: '',
  applicablePlanSlugs: [],
  startsAt: '',
  expiresAt: '',
  maxUses: '',
  perUserLimit: '',
  firstPurchaseOnly: false,
  stackableWithOther: false,
});

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO instant -> `YYYY-MM-DDTHH:mm` in the browser's time zone (what a `datetime-local` input holds). */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value -> ISO 8601 instant (the offset is the browser's), or null when blank or not a date. */
export function localInputToIso(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const toCouponDraft = (c: Coupon): CouponDraft => ({
  code: c.code,
  description: c.description ?? '',
  adminNote: c.adminNote ?? '',
  isActive: c.isActive,
  type: c.type,
  amount: trimDecimal(c.amount),
  maxDiscountAmount: c.maxDiscountAmount === null ? '' : trimDecimal(c.maxDiscountAmount),
  currencyCode: c.currencyCode ?? '',
  minOrderAmount: c.minOrderAmount === null ? '' : trimDecimal(c.minOrderAmount),
  applicablePlanSlugs: [...c.applicablePlanSlugs],
  startsAt: isoToLocalInput(c.startsAt),
  expiresAt: isoToLocalInput(c.expiresAt),
  maxUses: c.maxUses === null ? '' : String(c.maxUses),
  perUserLimit: c.perUserLimit === null ? '' : String(c.perUserLimit),
  firstPurchaseOnly: c.firstPurchaseOnly,
  stackableWithOther: c.stackableWithOther,
});

const MONEY = /^\d{1,8}(\.\d{1,4})?$/;
const blankToNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/**
 * The request body for a draft. The code is upper-cased; blank optional fields are sent as null (so clearing a cap, a limit or
 * a date on edit really clears it); an empty plan selection is an explicit `[]` (clears the restriction: a documented fix of a
 * Reference bug, where an empty multi-select left the old plans in place); dates become ISO 8601 instants.
 */
export function buildCouponPayload(d: CouponDraft): CreateCouponRequest {
  const count = (s: string): number | null => (s.trim() === '' ? null : Number(s.trim()));
  return {
    code: d.code.trim().toUpperCase(),
    description: blankToNull(d.description),
    adminNote: blankToNull(d.adminNote),
    type: d.type,
    amount: d.amount.trim(),
    maxDiscountAmount: blankToNull(d.maxDiscountAmount),
    currencyCode: blankToNull(d.currencyCode),
    minOrderAmount: blankToNull(d.minOrderAmount),
    maxUses: count(d.maxUses),
    perUserLimit: count(d.perUserLimit),
    applicablePlanSlugs: [...d.applicablePlanSlugs],
    startsAt: localInputToIso(d.startsAt),
    expiresAt: localInputToIso(d.expiresAt),
    isActive: d.isActive,
    firstPurchaseOnly: d.firstPurchaseOnly,
    stackableWithOther: d.stackableWithOther,
  };
}

function problemsOf(d: CouponDraft): CouponProblems {
  const p: CouponProblems = {};
  const code = d.code.trim();
  if (!code) p.code = 'required';
  else if (code.length > COUPON_LIMITS.code) p.code = 'tooLong';
  if (d.description.trim().length > COUPON_LIMITS.description) p.description = 'tooLong';
  if (d.adminNote.trim().length > COUPON_LIMITS.adminNote) p.adminNote = 'tooLong';
  const amount = d.amount.trim();
  if (!amount) p.amount = 'required';
  else if (!MONEY.test(amount)) p.amount = 'money';
  for (const f of ['maxDiscountAmount', 'minOrderAmount'] as const) {
    const v = d[f].trim();
    if (v && !MONEY.test(v)) p[f] = 'money';
  }
  if (d.currencyCode.trim().length > 8) p.currencyCode = 'tooLong';
  for (const f of ['maxUses', 'perUserLimit'] as const) {
    const v = d[f].trim();
    if (v && !(/^\d{1,10}$/.test(v) && Number(v) >= 1 && Number(v) <= 2_000_000_000))
      p[f] = 'count';
  }
  for (const f of ['startsAt', 'expiresAt'] as const) {
    if (d[f].trim() && localInputToIso(d[f]) === null) p[f] = 'date';
  }
  const start = localInputToIso(d.startsAt);
  const end = localInputToIso(d.expiresAt);
  if (!p.startsAt && !p.expiresAt && start && end && new Date(end) < new Date(start)) {
    p.expiresAt = 'window';
  }
  return p;
}

/**
 * Checks a draft the way the API will (the contract's own schema runs last as a safety net, so the form can never accept what
 * the API would refuse). Returns the body (with the row version when editing) or the fields to mark.
 */
export function checkCoupon(
  draft: CouponDraft,
  rowVersion?: number,
):
  | { ok: true; input: CreateCouponRequest | UpdateCouponRequest }
  | { ok: false; problems: CouponProblems } {
  const problems = problemsOf(draft);
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  const body = buildCouponPayload(draft);
  const parsed = createCouponRequestSchema.safeParse(body);
  if (!parsed.success) {
    const out: CouponProblems = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((FORM_FIELDS as readonly unknown[]).includes(field)) {
        out[field as FormField] ??= 'invalid';
      }
    }
    return { ok: false, problems: Object.keys(out).length > 0 ? out : { code: 'invalid' } };
  }
  return { ok: true, input: rowVersion === undefined ? body : { ...body, rowVersion } };
}

export type CouponSubmitError =
  { kind: 'stale' } | { kind: 'fields'; problems: CouponProblems } | { kind: 'other' };

/** What a failed save means for the form: a stale version (409), a taken code, an unknown plan, fields the server refused (422). */
export function couponSubmitError(err: unknown): CouponSubmitError {
  if (!(err instanceof ApiError)) return { kind: 'other' };
  if (err.isRowVersionConflict) return { kind: 'stale' };
  if (err.code === 'CPN_COUPON_CODE_TAKEN') return { kind: 'fields', problems: { code: 'taken' } };
  if (err.code === 'CPN_COUPON_PLAN_UNKNOWN') {
    return { kind: 'fields', problems: { applicablePlanSlugs: 'unknownPlan' } };
  }
  if (err.fieldErrors.length > 0) {
    const problems: CouponProblems = {};
    for (const e of err.fieldErrors) {
      const field = e.path.split('.')[0];
      if ((FORM_FIELDS as readonly unknown[]).includes(field)) {
        problems[field as FormField] ??= field === 'expiresAt' ? 'window' : 'invalid';
      }
    }
    if (Object.keys(problems).length > 0) return { kind: 'fields', problems };
  }
  return { kind: 'other' };
}

/** Plans matching the typed filter (name or slug), minus the ones already chosen. */
export function filterPlanOptions<T extends { slug: string; name: string }>(
  options: readonly T[],
  chosen: readonly string[],
  filter: string,
): T[] {
  const f = filter.trim().toLowerCase();
  return options.filter(
    (o) =>
      !chosen.includes(o.slug) &&
      (f === '' || o.name.toLowerCase().includes(f) || o.slug.toLowerCase().includes(f)),
  );
}
