import { z } from 'zod';

/**
 * Meta's published rate card, one per billing currency (USD, INR, ...). A workspace billed in INR is priced against Meta's INR card,
 * not the USD one converted. The operator imports the file Meta publishes each quarter; these shapes carry the cards, their age and
 * the reminder to renew them.
 */

export const META_CARD_CATEGORIES = [
  'marketing',
  'utility',
  'authentication',
  'authentication_international',
  'service',
] as const;
export type MetaCardCategory = (typeof META_CARD_CATEGORIES)[number];

/** Whether the card is still the one Meta publishes now. `due`: a quarter began after it was last checked, so Meta may have changed prices. */
export const metaCardFreshnessSchema = z.object({
  state: z.enum(['current', 'upcoming', 'due']),
  /** First day (YYYY-MM-DD) of the quarter we are in. */
  quarterStart: z.string(),
  /** First day of the next quarter, the next date Meta may change prices. */
  nextQuarterStart: z.string(),
  daysUntilNext: z.number().int(),
});
export type MetaCardFreshness = z.infer<typeof metaCardFreshnessSchema>;

export const metaCardSummarySchema = z.object({
  currency: z.string(),
  /** The date written in Meta's file. */
  effectiveOn: z.string(),
  /** When the operator last imported (and so confirmed) this card, YYYY-MM-DD. */
  checkedOn: z.string(),
  sourceLabel: z.string(),
  markets: z.number().int(),
  rows: z.number().int(),
  /** The platform currency's card also drives the Meta cost used for margins and the reseller P&L. */
  isPlatformCurrency: z.boolean(),
  freshness: metaCardFreshnessSchema,
});
export type MetaCardSummary = z.infer<typeof metaCardSummarySchema>;

export const metaCardsResponseSchema = z.object({
  platformCurrency: z.string(),
  cards: z.array(metaCardSummarySchema),
  /** Currencies in use (the platform's and the currencies workspaces are set to) that have no card yet. */
  missing: z.array(z.string()),
  /** Today's reminder across the cards, so one banner can say it. */
  reminder: metaCardFreshnessSchema,
});
export type MetaCardsResponse = z.infer<typeof metaCardsResponseSchema>;

export const metaCardMarketRowSchema = z.object({
  market: z.string(),
  /** ISO countries the market covers; empty for "Other" (every country not named). */
  countries: z.array(z.string()),
  /** Cost per message as a decimal string in the card's currency; null when Meta lists none for the category. */
  costs: z.record(z.enum(META_CARD_CATEGORIES), z.string().nullable()),
});
export type MetaCardMarketRow = z.infer<typeof metaCardMarketRowSchema>;

export const metaCardDetailSchema = z.object({
  card: metaCardSummarySchema,
  markets: z.array(metaCardMarketRowSchema),
});
export type MetaCardDetail = z.infer<typeof metaCardDetailSchema>;

export const importMetaCardSchema = z.object({
  /** The file exactly as Meta published it (.xlsx, or a CSV saved from it), base64. At most 2 MB of file. */
  file: z.string().min(1).max(3_000_000),
  fileName: z.string().trim().max(200).optional(),
  /** True reads the file and reports what would change without writing anything. */
  dryRun: z.boolean().default(false),
});
export type ImportMetaCardInput = z.infer<typeof importMetaCardSchema>;

export const importMetaCardResultSchema = z.object({
  dryRun: z.boolean(),
  currency: z.string(),
  effectiveOn: z.string(),
  /** The card this one replaces, if any (its effective date), so the operator sees what they are overwriting. */
  replaces: z.string().nullable(),
  added: z.number().int(),
  changed: z.number().int(),
  unchanged: z.number().int(),
  removed: z.number().int(),
  /** The largest moves, so a surprising card is noticed before it is applied. */
  biggestChanges: z.array(
    z.object({
      market: z.string(),
      category: z.enum(META_CARD_CATEGORIES),
      before: z.string().nullable(),
      after: z.string(),
    }),
  ),
  /** Row-level faults that did not stop the import (an unknown market, a bad amount). */
  problems: z.array(z.string()),
  /** True when this is the platform currency's card: the costs used for pricing were refreshed too. */
  appliedToPricing: z.boolean(),
  /** What refreshing the pricing costs changed (platform currency only). */
  pricing: z.object({ added: z.number().int(), updated: z.number().int() }).nullable(),
});
export type ImportMetaCardResult = z.infer<typeof importMetaCardResultSchema>;
