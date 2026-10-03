import {
  createCouponRequestSchema,
  type CouponItem,
  type CouponType,
  type CreateCouponPayload,
} from '@crm/contracts';

/** The coupon form's state: every input is text so a half-typed value never turns into NaN. */
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
  applicablePlans: string[];
  /** `datetime-local` value in the browser's own time zone ("2026-06-15T09:30"), or ''. */
  startsAt: string;
  expiresAt: string;
  maxUses: string;
  perUserLimit: string;
  firstPurchaseOnly: boolean;
  stackableWithOther: boolean;
}

export const newCouponDraft = (): CouponDraft => ({
  code: '',
  description: '',
  adminNote: '',
  isActive: true,
  type: 'percent',
  amount: '',
  maxDiscountAmount: '',
  currencyCode: '',
  minOrderAmount: '',
  applicablePlans: [],
  startsAt: '',
  expiresAt: '',
  maxUses: '',
  perUserLimit: '',
  firstPurchaseOnly: false,
  stackableWithOther: false,
});

const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO instant as the browser-local `datetime-local` value (Reference showed the stored time in the app's time zone). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The inverse: a `datetime-local` value as an ISO instant, or null when blank or unreadable. */
export function fromLocalInput(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const couponToDraft = (c: CouponItem): CouponDraft => ({
  code: c.code,
  description: c.description ?? '',
  adminNote: c.adminNote ?? '',
  isActive: c.isActive,
  type: c.type,
  amount: c.amount,
  maxDiscountAmount: c.maxDiscountAmount ?? '',
  currencyCode: c.currencyCode ?? '',
  minOrderAmount: c.minOrderAmount ?? '',
  applicablePlans: [...c.applicablePlans],
  startsAt: toLocalInput(c.startsAt),
  expiresAt: toLocalInput(c.expiresAt),
  maxUses: c.maxUses === null ? '' : String(c.maxUses),
  perUserLimit: c.perUserLimit === null ? '' : String(c.perUserLimit),
  firstPurchaseOnly: c.firstPurchaseOnly,
  stackableWithOther: c.stackableWithOther,
});

export type CouponField =
  | 'code'
  | 'description'
  | 'adminNote'
  | 'type'
  | 'amount'
  | 'maxDiscountAmount'
  | 'currencyCode'
  | 'minOrderAmount'
  | 'applicablePlans'
  | 'startsAt'
  | 'expiresAt'
  | 'maxUses'
  | 'perUserLimit';

const FIELDS: readonly CouponField[] = [
  'code',
  'description',
  'adminNote',
  'type',
  'amount',
  'maxDiscountAmount',
  'currencyCode',
  'minOrderAmount',
  'applicablePlans',
  'startsAt',
  'expiresAt',
  'maxUses',
  'perUserLimit',
];

export type CouponBuildResult =
  { ok: true; body: CreateCouponPayload } | { ok: false; problems: CouponField[] };

const wholeOrNaN = (v: string): number | null =>
  v.trim() === '' ? null : /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;

/**
 * Validates with the same schema the API uses, so the form and the server cannot disagree. Returns the request body or the list
 * of fields to flag (each once, in form order).
 */
export function buildCouponRequest(d: CouponDraft): CouponBuildResult {
  const startsAt = fromLocalInput(d.startsAt);
  const expiresAt = fromLocalInput(d.expiresAt);
  const parsed = createCouponRequestSchema.safeParse({
    code: d.code,
    description: d.description,
    adminNote: d.adminNote,
    type: d.type,
    amount: d.amount,
    // stored whatever the type, as in Reference; the engine only uses it for a percent coupon
    maxDiscountAmount: d.maxDiscountAmount,
    currencyCode: d.currencyCode,
    minOrderAmount: d.minOrderAmount,
    maxUses: wholeOrNaN(d.maxUses),
    perUserLimit: wholeOrNaN(d.perUserLimit),
    applicablePlans: d.applicablePlans,
    startsAt: d.startsAt.trim() && startsAt === null ? 'invalid' : startsAt,
    expiresAt: d.expiresAt.trim() && expiresAt === null ? 'invalid' : expiresAt,
    isActive: d.isActive,
    firstPurchaseOnly: d.firstPurchaseOnly,
    stackableWithOther: d.stackableWithOther,
  });
  if (parsed.success) return { ok: true, body: parsed.data };
  const bad = new Set<CouponField>();
  for (const issue of parsed.error.issues) {
    const root = String(issue.path[0]) as CouponField;
    if (FIELDS.includes(root)) bad.add(root);
  }
  return { ok: false, problems: FIELDS.filter((f) => bad.has(f)) };
}

export const isDraftDirty = (a: CouponDraft, b: CouponDraft): boolean =>
  JSON.stringify(a) !== JSON.stringify(b);
