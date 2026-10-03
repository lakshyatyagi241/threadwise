import { z } from 'zod';

/**
 * The public delivery address of a push or webhook-relay connection: `POST /v2/public/marketplace/hooks/:publicKey`. No session; the
 * sender proves itself with the connection secret (a header token, or an HMAC of the raw body). A delivery is acknowledged only after
 * it reached the lead pipeline, so a sender that retries on an error never loses a lead; a repeat of the same lead is `duplicate`.
 */

/** The 32 hex characters that name a connection in its URL. Not a secret on its own. */
export const MARKET_HOOK_KEY_RE = /^[0-9a-f]{32}$/;
export const marketHookKeySchema = z.string().regex(MARKET_HOOK_KEY_RE);

/** The headers a sender may use. Names are lowercase here; HTTP header names are case-insensitive. */
export const MARKET_HOOK_TOKEN_HEADER = 'x-marketplace-token';
export const MARKET_HOOK_SIGNATURE_HEADER = 'x-marketplace-signature';

/** The largest delivery accepted, in bytes. */
export const MARKET_HOOK_MAX_BYTES = 256 * 1024;

export const marketHookResultSchema = z.object({
  status: z.enum(['accepted', 'duplicate']),
  /** Leads in the delivery: more than one when the recipe reads an array. */
  received: z.number().int(),
  accepted: z.number().int(),
  duplicates: z.number().int(),
  /** Leads in the delivery that the recipe's mapping could not turn into a lead (a required field is missing). */
  rejected: z.number().int(),
});
export type MarketHookResult = z.infer<typeof marketHookResultSchema>;
