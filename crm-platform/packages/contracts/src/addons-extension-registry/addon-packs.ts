import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { isMoney, moneyCents, normaliseMoney } from '../plans-subscriptions-trials/money';
import { planBillingUnitSchema } from '../plans-subscriptions-trials/plan';

/**
 * Billing add-ons ("add-on packs", TW-ADD-025..033): an a-la-carte feature/limit pack a workspace buys on top of its
 * plan. Stored in the plan catalogue with kind = 'addon'. Money is a decimal string end to end.
 *
 * Grants: `features` is a list of flag keys the pack turns on; `limits` maps a limit key to a delta that is ADDED to
 * the plan's cap (a positive whole number) or -1 for "unlimited". A blank or 0 limit is "not granted" and is never
 * stored (TW-ADD-028 rule 3).
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
  /**
   * `recurring` is how an add-on is sold: a monthly or yearly subscription (autopay where the gateway can, otherwise the buyer pays again at the
   * end of each term). Left out on CREATE it becomes `recurring` for a priced pack and `one_time` only for a lifetime or zero-priced one (the
   * legacy shapes an older client may still send; see `createAddonRequestSchema`). A lifetime or free pack cannot be recurring.
   */
  billingMode: z.enum(['one_time', 'recurring']).optional(),
  isLifetime: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  features: z.array(z.string().regex(ADDON_KEY_RE)).max(200).default([]),
  limits: z.record(z.string().regex(ADDON_KEY_RE), limitInputSchema).default({}),
};

export interface AddonRuleInput {
  amount: string;
  offerAmount: string | null;
  billingMode?: 'one_time' | 'recurring';
  isLifetime?: boolean;
}

/** The cross-field rule: an offer is a discount, strictly below the price; a free pack has none (TW-ADD-028 rule 1). */
export function checkAddonRules(
  p: AddonRuleInput,
): Array<{ path: 'offerAmount' | 'billingMode'; message: string }> {
  const out: Array<{ path: 'offerAmount' | 'billingMode'; message: string }> = [];
  if (
    p.offerAmount !== null &&
    (moneyCents(p.amount) === 0 || moneyCents(p.offerAmount) >= moneyCents(p.amount))
  ) {
    out.push({ path: 'offerAmount', message: 'The offer price must be lower than the price.' });
  }
  if (p.billingMode === 'recurring' && (p.isLifetime || moneyCents(p.amount) === 0)) {
    out.push({
      path: 'billingMode',
      message: 'A free or lifetime add-on cannot renew automatically.',
    });
  }
  return out;
}

/**
 * New packs are recurring by default (owner decision 2026-10-22). Backward compatible: a client that sends `billingMode` is taken at its word
 * (so the rules below still apply), and one that sends none gets `recurring` when the pack is priced and not lifetime, and `one_time` for the
 * legacy lifetime / zero-priced shapes, which could never recur. Existing packs are not touched.
 */
export const defaultAddonBillingMode = (p: {
  amount: string;
  isLifetime?: boolean;
}): 'one_time' | 'recurring' =>
  p.isLifetime || moneyCents(p.amount) === 0 ? 'one_time' : 'recurring';

export const createAddonRequestSchema = z
  .object(addonFieldsShape)
  .superRefine((value, ctx) => {
    for (const issue of checkAddonRules(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }
  })
  .transform((value) => ({
    ...value,
    billingMode: value.billingMode ?? defaultAddonBillingMode(value),
  }));
export type CreateAddonRequest = z.input<typeof createAddonRequestSchema>;

/** A pack the operator can no longer create but that keeps selling: one-time, lifetime, or on a billing period that is not one month or one year. */
export const isLegacyAddonPack = (p: {
  billingMode: 'one_time' | 'recurring';
  isLifetime: boolean;
  billingUnit: string;
  billingDuration: number;
}): boolean =>
  p.billingMode !== 'recurring' ||
  p.isLifetime ||
  !((p.billingUnit === 'months' || p.billingUnit === 'years') && p.billingDuration === 1);
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
  billingMode: z.enum(['one_time', 'recurring']),
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

// --- what a workspace sees (TW-ADD-033) --------------------------------------------------------------------

export const addonBulletSchema = z.object({
  kind: z.enum(['feature', 'limit_unlimited', 'limit_add']),
  key: z.string(),
  /** What the screen shows for the key (a module's own label, or the key spelled out). */
  label: z.string(),
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
  billingMode: z.enum(['one_time', 'recurring']),
  /** At most five. */
  grantBullets: z.array(addonBulletSchema).max(5),
  ownedCount: z.number().int().nonnegative(),
  /** Of the live purchases of this pack: the latest end (null = none, or a lifetime one), and whether any of them still renews. */
  ownedEndsAt: z.string().datetime().nullable(),
  ownedRenews: z.boolean(),
  /**
   * buy | active (a feature-only pack already owned) | buy_again (a pack with limits stacks) | included (every feature of the pack is
   * already granted by the plan and the pack adds no cap: nothing to buy; a workspace that owns it may cancel it).
   * `grantBullets` lists only what the plan does not already give.
   */
  state: z.enum(['buy', 'active', 'buy_again', 'included', 'unavailable']),
  /**
   * Under `included`: who made it free. `plan` = the plan's own features, `support` = a workspace override or platform-owned status (the card says
   * "enabled by your account manager"). Null otherwise.
   */
  includedVia: z.enum(['plan', 'support']).nullable().default(null),
});
export type AddonCard = z.infer<typeof addonCardSchema>;

export const ownedAddonSchema = z.object({
  id: uuidSchema,
  packId: uuidSchema,
  name: z.string(),
  startsAt: z.string().datetime().nullable(),
  /** null = lifetime. */
  endsAt: z.string().datetime().nullable(),
  /** An autopay subscription is live for this purchase: it renews on its own until cancelled. */
  renews: z.boolean(),
});
export type OwnedAddon = z.infer<typeof ownedAddonSchema>;

/** Why the workspace cannot buy add-ons right now (it is not on an active paid plan). */
export const ADDON_UNAVAILABLE_REASONS = ['free_plan', 'plan_expired', 'no_plan'] as const;
export type AddonUnavailableReason = (typeof ADDON_UNAVAILABLE_REASONS)[number];

export const workspaceAddonsResponseSchema = z.object({
  /**
   * An add-on is bought on top of an active paid plan (TW-ADD-033). When false, `catalog` still lists the packs on sale, every card in the
   * `unavailable` state (or `included` when the plan already grants it), and `unavailableReason` says why.
   */
  eligible: z.boolean(),
  unavailableReason: z.enum(ADDON_UNAVAILABLE_REASONS).nullable().default(null),
  /** The caller may start a purchase (`paygw.checkout.create`). Anyone may see the list; without this the buy button is disabled. */
  canBuy: z.boolean().default(true),
  owned: z.array(ownedAddonSchema),
  catalog: z.array(addonCardSchema),
});
export type WorkspaceAddonsResponse = z.infer<typeof workspaceAddonsResponseSchema>;

// --- one ownership state for every paid thing --------------------------------------------------------------------------------------------

/**
 * The four things a workspace can be told about ANYTHING it could pay for (a plain add-on pack, or a paid Marketplace app):
 *   included    the plan (or an override) already gives everything it gives: no charge, nothing to buy
 *   owned       the workspace holds a live purchase of it
 *   buyable     it can be bought now
 *   unavailable it cannot be bought now (no active paid plan for a plain pack; not on sale for an app)
 * Order matters and is the whole rule: included beats owned (a held purchase of something the plan now includes is only ending), owned
 * beats buyable, and unavailable is only what is left when it is neither included nor owned.
 */
export type OwnershipState = 'included' | 'owned' | 'buyable' | 'unavailable';

export function resolveOwnership(f: {
  /** The plan already grants everything the item gives (and the item sells no cap on top). */
  includedByPlan: boolean;
  /** The workspace holds a live purchase. */
  owned: boolean;
  /** It could be bought if the workspace wanted. */
  purchasable: boolean;
}): OwnershipState {
  if (f.includedByPlan) return 'included';
  if (f.owned) return 'owned';
  return f.purchasable ? 'buyable' : 'unavailable';
}

/** A Marketplace app's `access` (see `accessFor`) as the same four states, so the two lists speak one language. */
export function ownershipFromAccess(
  access: 'free' | 'included' | 'entitled' | 'subscription_required' | 'not_for_sale',
): OwnershipState | 'free' {
  switch (access) {
    case 'free':
      return 'free';
    case 'included':
      return 'included';
    case 'entitled':
      return 'owned';
    case 'subscription_required':
      return 'buyable';
    case 'not_for_sale':
      return 'unavailable';
  }
}
