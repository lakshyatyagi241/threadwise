import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { isMoney, moneyCents, normaliseMoney } from '../plans-subscriptions-trials/money';
import { planBillingUnitSchema } from '../plans-subscriptions-trials/plan';

/**
 * Billing add-ons ("add-on packs", WD-ADD-025..033): an a-la-carte feature/limit pack a workspace buys on top of its
 * plan. Stored in the plan catalogue with kind = 'addon'. Money is a decimal string end to end.
 *
 * Grants: `features` is a list of flag keys the pack turns on; `limits` maps a limit key to a delta that is ADDED to
 * the plan's cap (a positive whole number) or -1 for "unlimited". A blank or 0 limit is "not granted" and is never
 * stored (WD-ADD-028 rule 3).
 */

export const ADDON_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const moneySchema = z
  .string()
  .trim()
  .refine(isMoney, 'Enter an amount such as 19 or 19.99.')
  .transform(normaliseMoney);

/** An offer of 0 (or blank) means "no offer". */
const offerSchema = z.preprocess((v) => {
  const blank = blankToNull(v);
  return typeof blank === 'string' && isMoney(blank.trim()) && moneyCents(blank.trim()) === 0
    ? null
    : blank;
}, moneySchema.nullable());

export const addonGrantsSchema = z.object({
  features: z.array(z.string()),
  limits: z.record(z.string(), z.number().int()),
});
export type AddonGrants = z.infer<typeof addonGrantsSchema>;

const limitInputSchema = z.union([z.number().int().min(-1).max(2_000_000_000), z.null()]);

const addonFieldsShape = {
  name: z.string().trim().min(1).max(120),
  subtitle: z.preprocess(blankToNull, z.string().trim().max(191).nullable()).default(null),
  detail: z.preprocess(blankToNull, z.string().trim().max(2000).nullable()).default(null),
  amount: moneySchema,
  offerAmount: offerSchema.default(null),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.'),
  billingUnit: planBillingUnitSchema.default('months'),
  billingDuration: z.number().int().min(1).max(120).default(1),
  isLifetime: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  features: z.array(z.string().regex(ADDON_KEY_RE)).max(200).default([]),
  limits: z.record(z.string().regex(ADDON_KEY_RE), limitInputSchema).default({}),
};

export interface AddonRuleInput {
  amount: string;
  offerAmount: string | null;
}

/** The cross-field rule: an offer is a discount, strictly below the price; a free pack has none (WD-ADD-028 rule 1). */
export function checkAddonRules(
  p: AddonRuleInput,
): Array<{ path: 'offerAmount'; message: string }> {
  if (p.offerAmount === null) return [];
  if (moneyCents(p.amount) === 0 || moneyCents(p.offerAmount) >= moneyCents(p.amount)) {
    return [{ path: 'offerAmount', message: 'The offer price must be lower than the price.' }];
  }
  return [];
}

export const createAddonRequestSchema = z
  .object(addonFieldsShape)
  .superRefine((value, ctx) => {
    for (const issue of checkAddonRules(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }
  });
export type CreateAddonRequest = z.input<typeof createAddonRequestSchema>;
export type CreateAddonPayload = z.output<typeof createAddonRequestSchema>;

/** Any subset of the fields; `rowVersion` is the optimistic lock. The service re-checks the merged result. */
export const updateAddonRequestSchema = z
  .object(addonFieldsShape)
  .partial()
  .extend({ rowVersion: z.number().int().positive() });
export type UpdateAddonRequest = z.input<typeof updateAddonRequestSchema>;
export type UpdateAddonPayload = z.output<typeof updateAddonRequestSchema>;

export const setAddonActiveRequestSchema = z.object({
  isActive: z.boolean(),
  rowVersion: z.number().int().positive(),
});
export type SetAddonActiveRequest = z.infer<typeof setAddonActiveRequestSchema>;

export const addonPackSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  subtitle: z.string().nullable(),
  detail: z.string().nullable(),
  amount: z.string(),
  offerAmount: z.string().nullable(),
  currency: z.string(),
  billingUnit: planBillingUnitSchema,
  billingDuration: z.number().int(),
  isFree: z.boolean(),
  isLifetime: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  grants: addonGrantsSchema,
  /** Workspaces holding an active purchase (the delete guard). */
  activePurchases: z.number().int().nonnegative(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AddonPack = z.infer<typeof addonPackSchema>;

export const addonPackListResponseSchema = z.object({
  data: z.array(addonPackSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
  }),
});
export type AddonPackListResponse = z.infer<typeof addonPackListResponseSchema>;

// --- what a workspace sees (WD-ADD-033) --------------------------------------------------------------------

export const addonBulletSchema = z.object({
  kind: z.enum(['feature', 'limit_unlimited', 'limit_add']),
  key: z.string(),
  /** The amount for 'limit_add'. */
  amount: z.number().int().nullable(),
});
export type AddonBullet = z.infer<typeof addonBulletSchema>;

export const addonCardSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  subtitle: z.string().nullable(),
  amount: z.string(),
  offerAmount: z.string().nullable(),
  currency: z.string(),
  isFree: z.boolean(),
  isLifetime: z.boolean(),
  billingUnit: planBillingUnitSchema,
  billingDuration: z.number().int(),
  /** At most five. */
  grantBullets: z.array(addonBulletSchema).max(5),
  ownedCount: z.number().int().nonnegative(),
  /** buy | active (a feature-only pack already owned) | buy_again (a pack with limits stacks). */
  state: z.enum(['buy', 'active', 'buy_again']),
});
export type AddonCard = z.infer<typeof addonCardSchema>;

export const ownedAddonSchema = z.object({
  id: uuidSchema,
  packId: uuidSchema,
  name: z.string(),
  startsAt: z.string().datetime().nullable(),
  /** null = lifetime. */
  endsAt: z.string().datetime().nullable(),
});
export type OwnedAddon = z.infer<typeof ownedAddonSchema>;

export const workspaceAddonsResponseSchema = z.object({
  /** An add-on needs an active paid plan (WD-ADD-033): otherwise the catalogue is withheld. */
  eligible: z.boolean(),
  owned: z.array(ownedAddonSchema),
  catalog: z.array(addonCardSchema),
});
export type WorkspaceAddonsResponse = z.infer<typeof workspaceAddonsResponseSchema>;
