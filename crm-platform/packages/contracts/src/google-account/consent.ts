import { z } from 'zod';
import { googleCapabilitySchema } from './capabilities';
import { googleReturnPathSchema } from './status';

/**
 * The confirmation step of connecting Google (TW-GACC-010). Google sends the browser to the API's callback, which cannot see the person's
 * session. It parks what Google returned (sealed) and sends the browser to a page of the app: the SAME signed-in admin who pressed
 * Connect, in the same workspace, confirms "connect <google email> to <workspace> for <permissions>", and only then is the grant stored.
 */
export const GOOGLE_CONSENT_STATUSES = [
  'pending',
  'awaiting_confirm',
  'confirmed',
  'cancelled',
  'rejected',
  'expired',
] as const;

export const googleConsentRequestSchema = z.object({
  id: z.string().uuid(),
  /** The Google account that consented (what the person is about to connect). */
  googleEmail: z.string().nullable(),
  workspaceName: z.string(),
  /** What this consent asked for, and what Google actually granted of it. */
  requested: z.array(googleCapabilitySchema),
  granted: z.array(googleCapabilitySchema),
  /** Requested permissions Google did not grant (a box was unticked). Confirming still stores what was granted when the account is already connected. */
  missing: z.array(googleCapabilitySchema),
  /** True when this connection replaces another Google account of the workspace. */
  replacesAccount: z.string().nullable(),
  expiresAt: z.string().datetime(),
  returnTo: googleReturnPathSchema,
});
export type GoogleConsentRequest = z.infer<typeof googleConsentRequestSchema>;

/** How a confirmation ended: the page returns to `returnTo` with `?calendar=<outcome>` like the old direct callback did. */
export const googleConsentResultSchema = z.object({
  outcome: z.enum(['connected', 'missing_scope', 'cancelled']),
  returnTo: googleReturnPathSchema,
});
export type GoogleConsentResult = z.infer<typeof googleConsentResultSchema>;
