import { z } from 'zod';

/**
 * Send an offer and the win-back broadcast (WD-ECOM-014, 015): one approved template sent to many customers. The answer is the
 * size of the audience; the sends run in the background and their counts land on the store's activity log.
 */

const coupon = z.string().trim().max(64).optional();

export const sendOfferSchema = z.object({
  templateUuid: z.string().uuid(),
  /** The contact group to send to; only opted-in members are messaged. */
  groupUuid: z.string().uuid(),
  /** The product the offer is about (its name, price and link fill the template). */
  productUuid: z.string().uuid().optional(),
  couponCode: coupon,
});
export type SendOfferInput = z.infer<typeof sendOfferSchema>;

export const sendWinbackSchema = z.object({
  templateUuid: z.string().uuid(),
  /** Customers whose last order is older than this many days; 0 means any time. Default 60. */
  days: z.number().int().min(0).max(365).default(60),
  minOrders: z.number().int().min(0).max(1000).default(0),
  /** In major units (12.5 is 12.50). */
  minSpent: z.number().min(0).default(0),
  couponCode: coupon,
});
export type SendWinbackInput = z.infer<typeof sendWinbackSchema>;

/** `ok = false` carries a reason shown inline ("That segment has no contactable (opted-in) members."). */
export const broadcastResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  /** How many customers will be messaged. */
  total: z.number().int().min(0).optional(),
  /** The sends were queued; sent and failed counts are on the activity log row when they finish. */
  queued: z.boolean().optional(),
});
export type BroadcastResult = z.infer<typeof broadcastResultSchema>;
