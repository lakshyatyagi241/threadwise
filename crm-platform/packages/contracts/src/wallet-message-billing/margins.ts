import { z } from 'zod';
import { rateCategorySchema } from './rates';
import { WALLET_LIMITS } from './money';

/**
 * Margin pricing: the customer pays Meta's cost plus OUR margin, per country and message category (WALLET pricing).
 * A margin is a percentage held as basis points (2500 = 25%; negative down to -10000 = free).
 * Layers, most specific first: the workspace's own override, then its plan's margin, then the platform default
 * (plan '' = every plan). Within a layer: country+category, country, category, default.
 */
export const PRICING_MODES = ['fixed', 'margin'] as const;
export const pricingModeSchema = z.enum(PRICING_MODES);
export type PricingMode = z.infer<typeof pricingModeSchema>;

export const MARGIN_BPS_MIN = -10_000;
export const MARGIN_BPS_MAX = 100_000;

/** "25" -> 2500, "12.5" -> 1250, "-100" -> -10000. Null when not a percentage with at most 2 decimals inside the allowed range. */
export function percentToBps(input: string | number): number | null {
  const text = (typeof input === 'number' ? String(input) : input).trim();
  const m = /^(-)?(\d{1,4})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const bps = (Number(m[2]) * 100 + Number(((m[3] ?? '') + '00').slice(0, 2))) * (m[1] ? -1 : 1);
  return bps >= MARGIN_BPS_MIN && bps <= MARGIN_BPS_MAX ? bps : null;
}

/** 2500 -> "25.00" */
export function bpsToPercent(bps: number): string {
  const sign = bps < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(bps));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Customer price of one message, hundredths: Meta cost (millionths of a unit) x (1 + margin), rounded to the nearest hundredth.
 * A cost of 0, or a margin of -100%, is free. Anything that would round to nothing but is not free costs one hundredth: the
 * ledger's smallest step is 0.01, so a sub-cent Meta cost is charged as 0.01 rather than given away.
 */
export function priceFromMargin(metaCostMicros: number, marginBps: number): number {
  if (metaCostMicros <= 0 || marginBps <= MARGIN_BPS_MIN) return 0;
  const minor = Math.round((metaCostMicros * (10_000 + marginBps)) / 100_000_000);
  return Math.max(1, minor);
}

export type MarginSource = 'workspace' | 'plan' | 'platform';

export const marginScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('platform') }),
  z.object({ type: z.literal('plan'), planSlug: z.string() }),
  z.object({ type: z.literal('workspace'), workspaceId: z.string().uuid() }),
]);

export const marginRowSchema = z.object({
  id: z.string().uuid(),
  countryCode: z.string(),
  countryName: z.string(),
  category: rateCategorySchema,
  marginBps: z.number().int(),
  /** Meta's cost for this country and category, a decimal string; null = unknown (the fixed price applies instead). */
  metaCost: z.string().nullable(),
  /** What a message costs the customer at this margin, hundredths; null when Meta's cost is unknown. */
  priceMinor: z.number().int().nullable(),
  /** Workspace overrides only: why, and who. */
  note: z.string().nullable(),
  setBy: z.string().nullable(),
  updatedAt: z.string(),
});
export type MarginRow = z.infer<typeof marginRowSchema>;

export const marginPlanSchema = z.object({ slug: z.string(), name: z.string() });

export const marginsResponseSchema = z.object({
  scope: marginScopeSchema,
  pricingMode: pricingModeSchema,
  currency: z.string(),
  /** The plans a margin can be set for; the platform default is `planSlug: ''`. */
  plans: z.array(marginPlanSchema),
  data: z.array(marginRowSchema),
  countries: z.array(z.object({ code: z.string(), name: z.string() })),
});
export type MarginsResponse = z.infer<typeof marginsResponseSchema>;

export const marginInputSchema = z.object({
  countryCode: z.string().trim().max(8).default(''),
  category: rateCategorySchema.default(''),
  /** Percent over Meta's cost, text with at most 2 decimals, e.g. "25" or "12.5". */
  margin: z.string().trim().max(10),
});
export type MarginInput = z.infer<typeof marginInputSchema>;

export const savePlanMarginsSchema = z.object({
  /** '' = the platform default for every plan. */
  planSlug: z.string().trim().max(64).default(''),
  rows: z.array(marginInputSchema).min(1).max(500),
});
export type SavePlanMarginsInput = z.infer<typeof savePlanMarginsSchema>;

/** A workspace override always carries the reason: it changes what one customer pays. */
export const saveWorkspaceMarginsSchema = z
  .object({
    rows: z.array(marginInputSchema).max(500).default([]),
    removeIds: z.array(z.string().uuid()).max(500).default([]),
    note: z
      .string()
      .trim()
      .min(WALLET_LIMITS.noteMin, `Say why in at least ${WALLET_LIMITS.noteMin} characters`)
      .max(WALLET_LIMITS.noteMax),
  })
  .refine((v) => v.rows.length > 0 || v.removeIds.length > 0, { message: 'Nothing to save' });
export type SaveWorkspaceMarginsInput = z.infer<typeof saveWorkspaceMarginsSchema>;

export const saveMarginsResultSchema = z.object({
  saved: z.number().int(),
  removed: z.number().int(),
  skipped: z.array(z.object({ index: z.number().int(), reason: z.string() })),
});
export type SaveMarginsResult = z.infer<typeof saveMarginsResultSchema>;

export const removePlanMarginResultSchema = z.object({ deleted: z.boolean() });

export const pricePreviewQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2})?$/)
    .default(''),
  category: rateCategorySchema.default(''),
});
export type PricePreviewQuery = z.infer<typeof pricePreviewQuerySchema>;

/** How one message would be priced and why: the numbers the operator needs to trust a margin. */
export const pricePreviewSchema = z.object({
  mode: pricingModeSchema,
  currency: z.string(),
  country: z.string(),
  category: z.string(),
  metaCost: z.string().nullable(),
  marginBps: z.number().int().nullable(),
  marginSource: z.enum(['workspace', 'plan', 'platform']).nullable(),
  /** Which margin row matched, e.g. `IN|marketing`. */
  matchedMargin: z.string().nullable(),
  priceMinor: z.number().int(),
  /** `margin` when Meta cost x margin set it, `fixed` when a typed price or the flat price did. */
  basis: z.enum(['margin', 'fixed']),
  matchedPrice: z.string(),
  planSlug: z.string().nullable(),
});
export type PricePreview = z.infer<typeof pricePreviewSchema>;
