import { z } from 'zod';
import { planCardSchema } from '../plans-subscriptions-trials/plan';

/**
 * The public pricing page's data (TW-CMS-003). The cards come from the PLAN catalogue (active plans only; add-ons are
 * excluded, a deliberate fix of Reference listing them); this adds what the page needs on top of a card.
 */
export const publicPlanCardSchema = planCardSchema.omit({ current: true, action: true }).extend({
  /** Discounted monthly price times twelve, when the plan is billed monthly and the yearly toggle applies. */
  yearlyAmount: z.string().nullable(),
  /** Where the card's button goes: register (free), register with the plan (paid), contact (custom quote). */
  ctaUrl: z.string(),
});
export type PublicPlanCard = z.infer<typeof publicPlanCardSchema>;

export const publicPricingResponseSchema = z.object({
  plans: z.array(publicPlanCardSchema),
  /** The Monthly/Yearly switch shows only when this is true AND some plan has a yearly price below twelve months. */
  yearlyToggle: z.boolean(),
  yearlyDiscountPct: z.number().int().min(0).max(90),
});
export type PublicPricingResponse = z.infer<typeof publicPricingResponseSchema>;
