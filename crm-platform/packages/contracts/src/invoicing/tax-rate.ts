import { z } from 'zod';
import { calendarDaySchema } from '../sales-docs/input-guards';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { queryBoolean } from '../contacts-attributes-tags/query-helpers';

/**
 * Tax rates (WD-INV: "tax rates" was missing in WaDesk, which had one free-form percent per line and a display-only default).
 * A rate is a named, typed percentage a line can point at: inclusive (already inside the price, VAT-style) or exclusive (added on
 * top), one of them the default of the workspace. A line SNAPSHOTS the name, type, percentage and inclusive flag, so editing or
 * deleting a rate never changes an invoice that was already written.
 *
 * Compound rates (India's GST 18% is CGST 9% + SGST 9% inside one state, IGST 18% across states) carry `components`; their
 * `rate` is the total. The tax engine decides which rate applies to a supply; this table is where the choices live.
 */
export const TAX_TYPES = [
  'vat',
  'gst',
  'cgst',
  'sgst',
  'utgst',
  'igst',
  'hst',
  'pst',
  'qst',
  'sales_tax',
  'sst',
  'consumption_tax',
  'iva',
  'tds',
  'tcs',
  'withholding',
  'custom',
  'other',
] as const;
export const taxTypeSchema = z.enum(TAX_TYPES);
export type TaxType = z.infer<typeof taxTypeSchema>;

export const TAX_RATE_NAME_MAX = 60;

const percent = z
  .string()
  .trim()
  .regex(
    /^\d{1,3}(\.\d{1,4})?$/,
    'a percent with at most 4 decimals, such as "18", "7.25" or "9.975"',
  );
const date = calendarDaySchema;
const country = z
  .string()
  .trim()
  .length(2)
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z]{2}$/.test(v), 'an ISO 3166-1 alpha-2 country code');
const hsn = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z]{2,12}$/, 'an HSN or SAC code is 2 to 12 letters or digits');

export const taxComponentSchema = z.object({
  /** "CGST", "SGST", "IGST", "PST", ... */
  type: z.string().trim().min(1).max(12),
  rate: percent,
});
export type TaxComponent = z.infer<typeof taxComponentSchema>;

export const taxRateResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  type: taxTypeSchema,
  /** Percent, "18" or "7.25". */
  rate: z.string(),
  inclusive: z.boolean(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  description: z.string().nullable(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  components: z.array(taxComponentSchema).nullable(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  /** Pre-fills the HSN/SAC of a line that uses this rate. */
  defaultHsnSac: z.string().nullable(),
  /** Invoice lines that point at it right now (a deleted rate leaves those lines' snapshots intact). */
  usedBy: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxRateResponse = z.infer<typeof taxRateResponseSchema>;

export const taxRatesResponseSchema = z.object({ data: z.array(taxRateResponseSchema) });
export type TaxRatesResponse = z.infer<typeof taxRatesResponseSchema>;

const taxRateBase = {
  name: z.string().trim().min(1).max(TAX_RATE_NAME_MAX),
  type: taxTypeSchema.optional(),
  rate: percent,
  inclusive: z.boolean().optional(),
  description: z.string().trim().max(500).nullish(),
  country: country.nullish(),
  region: z.string().trim().min(1).max(8).nullish(),
  components: z.array(taxComponentSchema).min(1).max(6).nullish(),
  effectiveFrom: date.nullish(),
  effectiveTo: date.nullish(),
  defaultHsnSac: hsn.nullish(),
};

export const createTaxRateSchema = z.object({
  ...taxRateBase,
  /** Make this the workspace default (the previous default stops being one). */
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type CreateTaxRateInput = z.infer<typeof createTaxRateSchema>;

export const updateTaxRateSchema = z.object({
  name: taxRateBase.name.optional(),
  type: taxRateBase.type,
  rate: percent.optional(),
  inclusive: z.boolean().optional(),
  description: taxRateBase.description,
  country: taxRateBase.country,
  region: taxRateBase.region,
  components: taxRateBase.components,
  effectiveFrom: taxRateBase.effectiveFrom,
  effectiveTo: taxRateBase.effectiveTo,
  defaultHsnSac: taxRateBase.defaultHsnSac,
  isActive: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateTaxRateInput = z.infer<typeof updateTaxRateSchema>;

export const listTaxRatesQuerySchema = z.object({
  /** Only rates that can be picked today (active and inside their effective window). */
  active: queryBoolean().optional(),
  country: country.optional(),
});
export type ListTaxRatesQuery = z.infer<typeof listTaxRatesQuerySchema>;

export const taxRatePageSchema = z.object({
  data: z.array(taxRateResponseSchema),
  page: pageInfoSchema,
});

// --- country presets (docs/tax-engine.md) -------------------------------------------------------------------------------------------

/**
 * Presets: the country's tax rates as ready-to-use rows, from the tax engine's profile of that country. They are DEFAULTS compiled
 * from public sources on a stated date, not legal or tax advice: the business verifies them with its accountant. Applying a preset
 * creates ordinary tax rates (editable, deletable); names already in use are skipped, so applying twice does nothing new.
 */
export const taxPresetRowSchema = z.object({
  /** Stable key of the row inside its country, for the `codes` of an apply call. */
  code: z.string(),
  name: z.string(),
  type: taxTypeSchema,
  rate: z.string(),
  inclusive: z.boolean(),
  isDefault: z.boolean(),
  region: z.string().nullable(),
  description: z.string().nullable(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  /** The compound parts of a combined rate (India's CGST + SGST). */
  components: z.array(taxComponentSchema).nullable(),
  /** True when a rate with this name already exists in the workspace. */
  exists: z.boolean(),
});
export type TaxPresetRow = z.infer<typeof taxPresetRowSchema>;

export const taxPresetsResponseSchema = z.object({
  country: z.string(),
  countryName: z.string(),
  /** The date the rates are in force on. */
  asOf: z.string(),
  data: z.array(taxPresetRowSchema),
  /** What to check before relying on the preset (thresholds, schemes, e-invoicing mandates). */
  notes: z.array(z.string()),
  disclaimer: z.string(),
});
export type TaxPresetsResponse = z.infer<typeof taxPresetsResponseSchema>;

export const listTaxPresetsQuerySchema = z.object({
  country: country,
  /** Rates in force on this date; default today. */
  asOf: date.optional(),
});
export type ListTaxPresetsQuery = z.infer<typeof listTaxPresetsQuerySchema>;

export const applyTaxPresetsSchema = z.object({
  country: country,
  /** Only these rows (their `code`); default every row in force today. */
  codes: z.array(z.string().min(1).max(64)).max(100).optional(),
  asOf: date.optional(),
  /** Make the country's default (standard) rate the workspace default when the workspace has none. */
  setDefault: z.boolean().default(true),
});
export type ApplyTaxPresetsInput = z.infer<typeof applyTaxPresetsSchema>;

export const applyTaxPresetsResponseSchema = z.object({
  created: z.array(taxRateResponseSchema),
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
});
export type ApplyTaxPresetsResponse = z.infer<typeof applyTaxPresetsResponseSchema>;
