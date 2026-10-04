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

/**
 * The address also takes the secret as the second path segment (`/hooks/<publicKey>/<secret>`, for a portal whose sender sets no header),
 * accepts GET with a query string, form bodies and XML where the recipe says so, and for a portal recipe that asks for it stores the
 * delivery whole and answers at once (`status: 'queued'`): the worker maps it and hands the leads to the pipeline, and a failure there is
 * retried from the stored copy, so the sender (which turns itself off after a day or two of errors) never sees one.
 */
export const marketHookResultSchema = z.object({
  /** `queued`: stored and being processed (the counts below are then zero); the others are the outcome of a delivery handled inline. */
  status: z.enum(['accepted', 'duplicate', 'queued']),
  /** Leads in the delivery: more than one when the recipe reads an array. */
  received: z.number().int(),
  accepted: z.number().int(),
  duplicates: z.number().int(),
  /** Leads in the delivery that the recipe's mapping could not turn into a lead (a required field is missing). */
  rejected: z.number().int(),
  /** `queued` only: the stored delivery's id, to quote to support. */
  event: z.string().uuid().optional(),
});
export type MarketHookResult = z.infer<typeof marketHookResultSchema>;
