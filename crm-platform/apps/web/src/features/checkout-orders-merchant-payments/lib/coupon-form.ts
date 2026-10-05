import type {
  CreateStoreCouponInput,
  StoreCoupon,
  StoreCouponType,
  UpdateStoreCouponInput,
} from '@crm/contracts';

/**
 * The coupon form's state (every field is text, as typed) and its conversion to and from the API shapes. Money is typed in major
 * units ("150.50") and goes out as integer minor units (15050); a percent coupon's value is a whole percentage.
 */

export interface CouponForm {
  code: string;
  type: StoreCouponType;
  /** Percent: "0".."100". Flat: major units. */
  value: string;
  minSubtotal: string;
  maxDiscount: string;
  freeShipping: boolean;
  active: boolean;
  /** `datetime-local` text ("2026-10-05T14:30") in the browser's time zone, or empty. */
  startsAt: string;
  expiresAt: string;
  usageLimit: string;
  /** A shop id, or empty for every shop. */
  storefrontId: string;
}

export type CouponField = keyof CouponForm;
/** A reason a field is refused; the screen turns it into a message under the field (`coupons.problems.<key>`). */
export type CouponProblem =
  | 'codeRequired'
  | 'codeInvalid'
  | 'valueRequired'
  | 'percentRange'
  | 'amountInvalid'
  | 'minInvalid'
  | 'maxInvalid'
  | 'dateInvalid'
  | 'windowInvalid'
  | 'limitInvalid';
export type CouponProblems = Partial<Record<CouponField, CouponProblem>>;

export const COUPON_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export function emptyCouponForm(storefrontId = ''): CouponForm {
  return {
    code: '',
    type: 'percent',
    value: '',
    minSubtotal: '',
    maxDiscount: '',
    freeShipping: false,
    active: true,
    startsAt: '',
    expiresAt: '',
    usageLimit: '',
    storefrontId,
  };
}

/** "150.5" -> 15050. Null when the text is not a non-negative amount with at most two decimals. No floating point on the way. */
export function majorToMinor(text: string): number | null {
  const s = text.trim().replace(',', '.');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(((m[2] ?? '') + '00').slice(0, 2));
}

/** 15050 -> "150.50"; 15000 -> "150". Whole amounts stay short, as people type them. */
export function minorToMajorText(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const cents = Math.abs(minor % 100);
  return cents === 0 ? String(whole) : `${whole}.${String(cents).padStart(2, '0')}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO time from the API as `datetime-local` text in the browser's time zone. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` text as an ISO time with an offset ("Z"), or null when empty or invalid. */
export function localInputToIso(text: string): string | null {
  if (!text.trim()) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function couponToForm(c: StoreCoupon): CouponForm {
  const percent = c.type === 'percent';
  return {
    code: c.code,
    type: percent ? 'percent' : 'flat',
    value: percent ? String(c.amount) : minorToMajorText(c.amount),
    minSubtotal: c.minSubtotalMinor ? minorToMajorText(c.minSubtotalMinor) : '',
    maxDiscount: c.maxDiscountMinor ? minorToMajorText(c.maxDiscountMinor) : '',
    freeShipping: c.freeShipping,
    active: c.active,
    startsAt: isoToLocalInput(c.startsAt),
    expiresAt: isoToLocalInput(c.expiresAt),
    usageLimit: c.usageLimit ? String(c.usageLimit) : '',
    storefrontId: c.storefrontId ?? '',
  };
}

/** Every problem of the form; empty means it can be sent. The server stays the judge of the code's uniqueness. */
export function validateCouponForm(f: CouponForm): CouponProblems {
  const p: CouponProblems = {};
  const code = f.code.trim();
  if (!code) p.code = 'codeRequired';
  else if (code.length > 64 || !COUPON_CODE_PATTERN.test(code)) p.code = 'codeInvalid';

  const value = f.value.trim();
  if (!value) p.value = 'valueRequired';
  else if (f.type === 'percent') {
    if (!/^\d{1,3}$/.test(value) || Number(value) > 100) p.value = 'percentRange';
  } else if (majorToMinor(value) === null) p.value = 'amountInvalid';

  if (f.minSubtotal.trim() && majorToMinor(f.minSubtotal) === null) p.minSubtotal = 'minInvalid';
  if (f.type === 'percent' && f.maxDiscount.trim() && majorToMinor(f.maxDiscount) === null) {
    p.maxDiscount = 'maxInvalid';
  }

  const starts = f.startsAt.trim() ? localInputToIso(f.startsAt) : null;
  const expires = f.expiresAt.trim() ? localInputToIso(f.expiresAt) : null;
  if (f.startsAt.trim() && !starts) p.startsAt = 'dateInvalid';
  if (f.expiresAt.trim() && !expires) p.expiresAt = 'dateInvalid';
  if (starts && expires && new Date(starts).getTime() >= new Date(expires).getTime()) {
    p.expiresAt = 'windowInvalid';
  }

  const limit = f.usageLimit.trim();
  if (limit && (!/^\d{1,9}$/.test(limit) || Number(limit) < 1)) p.usageLimit = 'limitInvalid';
  return p;
}

export const hasProblems = (p: CouponProblems): boolean => Object.keys(p).length > 0;

/** The request body. Call only for a form that validated. A flat coupon has no cap; the code goes out as typed, uppercased. */
export function toCouponInput(f: CouponForm): CreateStoreCouponInput {
  const percent = f.type === 'percent';
  return {
    code: f.code.trim().toUpperCase(),
    type: f.type,
    amount: percent ? Number(f.value.trim()) : (majorToMinor(f.value) ?? 0),
    minSubtotalMinor: f.minSubtotal.trim() ? majorToMinor(f.minSubtotal) : null,
    maxDiscountMinor: percent && f.maxDiscount.trim() ? majorToMinor(f.maxDiscount) : null,
    freeShipping: f.freeShipping,
    active: f.active,
    startsAt: localInputToIso(f.startsAt),
    expiresAt: localInputToIso(f.expiresAt),
    usageLimit: f.usageLimit.trim() ? Number(f.usageLimit.trim()) : null,
    storefrontId: f.storefrontId || null,
  };
}

export function toCouponUpdate(f: CouponForm, rowVersion: number): UpdateStoreCouponInput {
  return { ...toCouponInput(f), rowVersion };
}

/** A suggestion for the code field: uppercase, without spaces or characters the code rule refuses. */
export function suggestCode(text: string): string {
  return text
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9_-]/g, '');
}
