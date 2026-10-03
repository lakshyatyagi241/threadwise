import { z } from 'zod';

/**
 * Credit packages (WD-WALLET-019): the optional "pay this, get this much wallet" offers an operator curates. WaDesk retired the
 * bundle checkout, so this is the catalogue only; a package whose wallet credit is above its price is a top-up bonus.
 */
export const creditPackageSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  currency: z.string(),
  /** What the customer pays, hundredths. */
  priceMinor: z.number().int().nonnegative(),
  /** What lands in the wallet, hundredths. */
  walletCreditMinor: z.number().int().positive(),
  /** Extra wallet credit over the price, percent (0 when there is none). */
  bonusPercent: z.number(),
  badge: z.string().nullable(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  sortOrder: z.number().int(),
  rowVersion: z.number().int(),
});
export type CreditPackage = z.infer<typeof creditPackageSchema>;

export const creditPackageListSchema = z.object({
  data: z.array(creditPackageSchema),
  currencies: z.array(z.string()),
});
export type CreditPackageList = z.infer<typeof creditPackageListSchema>;

const money = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals');

export const creditPackageInputSchema = z.object({
  name: z.string().trim().min(1).max(96),
  /** Blank = made from the name; a taken slug gets -2, -3, ... */
  slug: z
    .string()
    .trim()
    .max(96)
    .regex(/^[A-Za-z0-9_-]*$/, 'Letters, numbers, dashes and underscores only')
    .default(''),
  description: z.string().trim().max(500).default(''),
  price: money.refine((v) => Number(v) <= 10_000_000, 'Too large'),
  currency: z.string().trim().toUpperCase().length(3),
  walletCredit: money.refine((v) => Number(v) > 0, 'Must be greater than 0'),
  badge: z.string().trim().max(32).default(''),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  /** Required when editing: a stale form is refused. */
  rowVersion: z.number().int().positive().optional(),
});
export type CreditPackageInput = z.infer<typeof creditPackageInputSchema>;
