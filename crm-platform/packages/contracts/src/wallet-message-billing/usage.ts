import { z } from 'zod';

/**
 * Everything that draws on the wallet besides a WhatsApp message (the message itself is priced by the rate card and reported as
 * `message.delivery_reported`). A usage is reported ONCE, as `usage.reported`, by the code that did the work; the worker's billing
 * consumer prices it, takes the money, writes the customer's expense row and, if the work later failed, gives the money back.
 */

/** What a charge row can be for. `whatsapp_message` is the original kind and the default of every older row. */
export const walletUsageKindSchema = z.enum([
  'whatsapp_message',
  'sms',
  'email',
  'whatsapp_call',
  'voice_call',
  'ai',
  'translation',
  'enrichment',
  'chat_message',
]);
export type WalletUsageKind = z.infer<typeof walletUsageKindSchema>;

/** The kinds reported through `usage.reported` (a WhatsApp message has its own event and rate card). */
export const walletReportedKindSchema = walletUsageKindSchema.exclude(['whatsapp_message']);
export type WalletReportedKind = z.infer<typeof walletReportedKindSchema>;

/** Kinds priced per unit by a price the operator types: a segment, an email, a minute, a lookup. */
export const WALLET_UNIT_PRICED_KINDS = [
  'sms',
  'email',
  'whatsapp_call',
  'voice_call',
  'enrichment',
  'chat_message',
] as const;
export const walletUnitPricedKindSchema = z.enum(WALLET_UNIT_PRICED_KINDS);
export type WalletUnitPricedKind = z.infer<typeof walletUnitPricedKindSchema>;

/** Kinds charged at what the vendor charged us plus the markup: AI calls and paid translation. */
export const WALLET_COST_PLUS_KINDS = ['ai', 'translation'] as const;
export const walletCostPlusKindSchema = z.enum(WALLET_COST_PLUS_KINDS);
export type WalletCostPlusKind = z.infer<typeof walletCostPlusKindSchema>;

/** What a unit is, per kind: the expense log and the price form say "per segment", "per minute". */
export const WALLET_UNIT_NAMES: Record<
  WalletUnitPricedKind,
  'segment' | 'email' | 'minute' | 'lookup' | 'message'
> = {
  sms: 'segment',
  email: 'email',
  whatsapp_call: 'minute',
  voice_call: 'minute',
  enrichment: 'lookup',
  chat_message: 'message',
};

/** Hard limits of one usage report. */
export const WALLET_USAGE_LIMITS = {
  /** A call of more than 24 hours or a message of more than a million segments is a bug, not a bill. */
  maxUnits: 100_000,
  /** The markup on a vendor cost, basis points: 1000 = 10%. */
  maxMarkupBps: 100_000,
  /** The per-unit price, hundredths: 10,000.00 a unit. */
  maxPriceMinor: 1_000_000,
} as const;

/** A label shown on the statement and the expense log. Cut to its length, never refused: a refused report would drop the charge. */
const label = (max: number) =>
  z
    .string()
    .trim()
    .transform((v) => v.slice(0, max))
    .nullable()
    .optional();

export const USAGE_REPORTED_EVENT = 'usage.reported';

export const walletUsageStatusSchema = z.enum(['used', 'failed']);
export type WalletUsageStatus = z.infer<typeof walletUsageStatusSchema>;

export const walletUsageReportedSchema = z.object({
  kind: walletReportedKindSchema,
  /** The id of the thing that was used: the SMS sid, the email message id, the call id, the AI request id. One charge per id. */
  usageId: z.string().trim().min(1).max(191),
  /** `used` bills it; `failed` gives a bill back (the SMS was not delivered, the call never connected). */
  status: walletUsageStatusSchema.default('used'),
  /** SMS segments, call minutes... 1 for an email or an AI call. Ignored for the cost-plus kinds. */
  units: z.number().int().min(0).max(WALLET_USAGE_LIMITS.maxUnits).default(1),
  /** What it was, in a few words: `AI lead scoring`, `SMS`. Shown on the statement. */
  label: label(120),
  /** The recipient's number, for the country of the charge. */
  recipient: z.string().trim().max(40).nullable().optional(),
  /** Where it came from, short and lowercase: `campaign`, `inbox`, `lead_scoring`, `flow`. Shown as the expense's source. */
  source: z.string().trim().max(24).nullable().optional(),
  /** The vendor or engine that did the work: `twilio`, `msg91`, `gmail`, `openrouter`. */
  provider: z.string().trim().max(40).nullable().optional(),
  /** What the vendor charged us, in US dollars; the cost-plus kinds are priced from it. */
  vendorCostUsd: z.number().min(0).max(100_000).nullable().optional(),
  /** The campaign, broadcast or schedule it belongs to, by name. */
  subjectName: label(255),
});
export type WalletUsageReported = z.infer<typeof walletUsageReportedSchema>;

// --- the operator's prices --------------------------------------------------------------------------------------------------------

/** One unit-priced kind as an operator sees it. `priceMinor` is hundredths of the platform currency per unit; 0 = free. */
export const walletUsagePriceSchema = z.object({
  kind: walletUnitPricedKindSchema,
  enabled: z.boolean(),
  priceMinor: z.number().int().min(0).max(WALLET_USAGE_LIMITS.maxPriceMinor),
  /** What one unit is: segment, email, minute... */
  unit: z.string(),
});
export type WalletUsagePrice = z.infer<typeof walletUsagePriceSchema>;

/** One cost-plus kind: charged at the vendor's cost plus the markup, or not charged at all. */
export const walletUsageCostPlusSchema = z.object({
  kind: walletCostPlusKindSchema,
  enabled: z.boolean(),
});
export type WalletUsageCostPlus = z.infer<typeof walletUsageCostPlusSchema>;

export const walletUsageSettingsSchema = z.object({
  currency: z.string(),
  prices: z.array(walletUsagePriceSchema),
  costPlus: z.array(walletUsageCostPlusSchema),
  /** The markup on a vendor cost, basis points (1000 = 10%). */
  markupBps: z.number().int().min(0).max(WALLET_USAGE_LIMITS.maxMarkupBps),
  updatedAt: z.string().nullable(),
});
export type WalletUsageSettings = z.infer<typeof walletUsageSettingsSchema>;

const priceText = z
  .string()
  .trim()
  .regex(/^\d{1,5}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals');

/** Send only what changes. Money is text, as everywhere in the wallet. */
export const updateWalletUsageSettingsSchema = z
  .object({
    prices: z
      .array(
        z.object({
          kind: walletUnitPricedKindSchema,
          enabled: z.boolean().optional(),
          price: priceText.optional(),
        }),
      )
      .max(WALLET_UNIT_PRICED_KINDS.length)
      .optional(),
    costPlus: z
      .array(z.object({ kind: walletCostPlusKindSchema, enabled: z.boolean() }))
      .max(WALLET_COST_PLUS_KINDS.length)
      .optional(),
    markupBps: z.number().int().min(0).max(WALLET_USAGE_LIMITS.maxMarkupBps).optional(),
  })
  .refine((v) => v.prices !== undefined || v.costPlus !== undefined || v.markupBps !== undefined, {
    message: 'Send at least one setting',
  });
export type UpdateWalletUsageSettingsInput = z.infer<typeof updateWalletUsageSettingsSchema>;
