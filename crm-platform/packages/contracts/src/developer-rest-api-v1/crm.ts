/**
 * developer-rest-api-v1 (API), group `crm`: account (`/me`, `/usage`), contacts, contact groups and deals (TW-API-020 to 029, 048 to 054).
 * Field names are Reference's snake_case; ids are uuids; timestamps are ISO-8601.
 */
import { z } from 'zod';

// --- account (TW-API-020, 021) ------------------------------------------------------------------------------------------------------

export const v1MeSchema = z.object({
  account: z.object({ name: z.string().nullable(), email: z.string().nullable() }),
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string().nullable(),
    currency: z.string().nullable(),
  }),
  plan: z.object({ id: z.string().nullable(), name: z.string().nullable(), is_free: z.boolean() }),
  /** One entry per metered key; null is unlimited. */
  limits: z.record(z.number().int().nullable()),
  /** `<feature_key>: true` for every unlocked feature. */
  features: z.record(z.literal(true)),
});
export type V1Me = z.infer<typeof v1MeSchema>;

const v1MeterSchema = z.object({
  label: z.string(),
  used: z.number().int(),
  limit: z.number().int().nullable(),
  unlimited: z.boolean(),
  percent: z.number().int().nullable(),
});

export const v1UsageSchema = z.object({
  period: z.object({ label: z.string(), resets_on: z.string(), days_left: z.number().int() }),
  plan: z.object({
    name: z.string().nullable(),
    valid_until: z.string().nullable(),
    valid_until_days: z.number().int().nullable(),
  }),
  messages: z.object({
    used: z.number().int(),
    limit: z.number().int().nullable(),
    unlimited: z.boolean(),
    remaining: z.number().int().nullable(),
    percent: z.number().int().nullable(),
  }),
  /** Wallet balance in minor units of `currency`, as a string (money rule). Reference answered a credit count. */
  credits: z.string(),
  currency: z.string(),
  meters: z.record(v1MeterSchema),
});
export type V1Usage = z.infer<typeof v1UsageSchema>;

// --- contacts (TW-API-022 to 026) ---------------------------------------------------------------------------------------------------

/** Laravel trims every string and turns "" into null before validating; Reference clients rely on both. */
const blankToNull = (v: unknown) =>
  typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v;
const text = (max: number) => z.preprocess(blankToNull, z.string().max(max).nullable().optional());

/** Laravel's `boolean` rule: true, false, 1, 0, "1", "0" (and the strings "true"/"false" that a form post sends). */
const flag = z.preprocess((v) => {
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return v;
}, z.boolean().nullable().optional());

/**
 * The person's agreement to marketing, with its proof (a product extension: Reference's API has only `is_unsubscribed`). Writing it
 * records a consent grant in the ledger with source `api`; without a `note` or `text` it is refused (422 CONSENT_NOTE_REQUIRED). The
 * channels default to the ones the contact can be reached on (a phone is WhatsApp, an email address is email).
 */
export const v1ConsentSchema = z
  .object({
    channels: z
      .array(z.enum(['whatsapp', 'sms', 'email']))
      .min(1)
      .max(3)
      .optional(),
    note: text(500),
    text: text(2000),
    version: text(64),
    at: z.string().datetime().optional(),
  })
  .nullable()
  .optional();

const contactFields = {
  middle_name: text(191),
  last_name: text(191),
  title: text(50),
  country_code: text(10),
  email: z.preprocess(blankToNull, z.string().email().max(191).nullable().optional()),
  language: text(80),
  address: text(1000),
  note: text(2000),
  /** An IANA time zone such as `Asia/Kolkata` (BL-193, a product extension): the quiet hours are read on it. `null` clears it. */
  timezone: text(64),
  group_ids: z.array(z.string().max(64)).nullable().optional(),
  attributes: z.record(z.unknown()).nullable().optional(),
  is_unsubscribed: flag,
  consent: v1ConsentSchema,
};

export const v1CreateContactSchema = z
  .object({
    name: text(191),
    first_name: text(191),
    phone: z.preprocess(
      blankToNull,
      z.string({ required_error: 'The phone field is required.' }).max(32),
    ),
    ...contactFields,
  })
  .superRefine((v, ctx) => {
    if (!v.name && !v.first_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'The name field is required when first name is not present.',
      });
    }
  });
export type V1CreateContact = z.infer<typeof v1CreateContactSchema>;

/** Every key optional; only the keys present in the body change. */
export const v1UpdateContactSchema = z.object({
  name: text(191),
  first_name: text(191),
  phone: text(32),
  ...contactFields,
});
export type V1UpdateContact = z.infer<typeof v1UpdateContactSchema>;

export const v1ContactsQuerySchema = z.object({ search: z.string().trim().max(200).optional() });
export type V1ContactsQuery = z.infer<typeof v1ContactsQuerySchema>;

export const v1ContactSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  tags: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  attributes: z.record(z.unknown()),
  /** The contact's own IANA time zone, or null (BL-193, a product extension). */
  timezone: z.string().nullable(),
  /** Who set it: `staff`, `import` or `api`; null when no zone is stored. */
  timezone_source: z.enum(['staff', 'import', 'api']).nullable(),
  created_at: z.string(),
});
export type V1Contact = z.infer<typeof v1ContactSchema>;

// --- contact groups (TW-API-027 to 029) -----------------------------------------------------------------------------------------------

export const v1CreateContactGroupSchema = z.object({
  name: z.preprocess(
    blankToNull,
    z.string({ required_error: 'The name field is required.' }).max(191),
  ),
  note: text(500),
  color: text(32),
});
export type V1CreateContactGroup = z.infer<typeof v1CreateContactGroupSchema>;

export const v1ContactGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  note: z.string().nullable(),
  color: z.string().nullable(),
  contacts_count: z.number().int(),
  created_at: z.string(),
});
export type V1ContactGroup = z.infer<typeof v1ContactGroupSchema>;

// --- deals (TW-API-048 to 054) -----------------------------------------------------------------------------------------------------

const dealStatus = z.enum(['open', 'won', 'lost']);

export const v1DealSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  stage: z.string().nullable(),
  status: dealStatus,
  /** Major units: a whole number when the minor amount divides evenly, else a decimal (Reference's `value_minor / 100`). */
  value: z.number(),
  value_minor: z.number().int(),
  currency: z.string(),
  contact_id: z.string().uuid().nullable(),
  owner_user_id: z.string().uuid().nullable(),
  source: z.string(),
  expected_close_date: z.string().nullable(),
  lost_reason: z.string().nullable(),
  won_at: z.string().nullable(),
  lost_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type V1Deal = z.infer<typeof v1DealSchema>;

/**
 * Rounds a non-negative decimal string to 2 places, half up (PHP's `round`), digit by digit so a float never touches the money:
 * "12.345" is "12.35", "0.004" is "0.00", "1.005" is "1.01". Reference stored `round(value * 100)` minor units, so a third decimal was
 * never refused.
 */
export function roundMoney2(value: string): string {
  const [int = '0', frac = ''] = value.split('.');
  if (frac.length <= 2) return value;
  let minor = BigInt(int + frac.slice(0, 2).padEnd(2, '0'));
  if (frac.charCodeAt(2) >= 53) minor += BigInt(1);
  const digits = minor.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Laravel's `numeric`: a number or a numeric string. Kept as typed text so the money is never rounded through a float. */
const dealValue = z.preprocess(
  (v) =>
    typeof v === 'number' && Number.isFinite(v)
      ? String(v)
      : typeof v === 'string' && v.trim() !== ''
        ? v.trim()
        : v === ''
          ? null
          : v,
  z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'The value must be a number of at least 0.')
    .refine((s) => Number(s) <= 99_999_999, 'The value must not be greater than 99999999.')
    .transform(roundMoney2)
    .nullable()
    .optional(),
);

/** A reference Reference resolves leniently (an unknown one falls back or clears): any scalar is accepted, the service decides. */
const looseRef = z.preprocess(
  (v) => (v === '' ? null : typeof v === 'number' ? String(v) : v),
  z.string().max(64).nullable().optional(),
);

const closeDate = z.preprocess(
  blankToNull,
  z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'The expected close date is not a valid date.')
    .nullable()
    .optional(),
);

export const v1CreateDealSchema = z.object({
  title: z.preprocess(
    blankToNull,
    z.string({ required_error: 'The title field is required.' }).max(191),
  ),
  pipeline_id: looseRef,
  stage_id: looseRef,
  value: dealValue,
  currency: text(10),
  contact_id: looseRef,
  owner_user_id: looseRef,
  expected_close_date: closeDate,
});
export type V1CreateDeal = z.infer<typeof v1CreateDealSchema>;

export const v1UpdateDealSchema = z.object({
  title: z.preprocess(
    blankToNull,
    z.string().min(1, 'The title field must not be empty.').max(191).optional(),
  ),
  value: dealValue,
  currency: text(10),
  stage_id: looseRef,
  contact_id: looseRef,
  owner_user_id: looseRef,
  expected_close_date: closeDate,
  lost_reason: text(191),
});
export type V1UpdateDeal = z.infer<typeof v1UpdateDealSchema>;

export const v1DealsQuerySchema = z.object({
  pipeline_id: z.string().max(64).optional(),
  stage_id: z.string().max(64).optional(),
  status: z.string().max(32).optional(),
});
export type V1DealsQuery = z.infer<typeof v1DealsQuerySchema>;
