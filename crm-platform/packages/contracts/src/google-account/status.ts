import { z } from 'zod';
import { googleCapabilitySchema } from './capabilities';

/**
 * The workspace's one Google account (TW-GACC-001 to 006): connected by an admin through Google's consent screen with the capabilities
 * they tick, shared by the appointments calendar and by the flow builder's Google nodes. The platform operator supplies the OAuth client
 * (console: Google Calendar settings); a workspace never sees a client id or secret.
 *
 * `unavailable`: the platform has no Google client (or the operator switched it off). `disconnected`: it can be connected.
 * `connected`: usable. `needs_reconnect`: Google refused the stored grant; nothing works until an admin connects again.
 */
export const GOOGLE_ACCOUNT_STATUSES = [
  'unavailable',
  'disconnected',
  'connected',
  'needs_reconnect',
] as const;
export const googleAccountStatusSchema = z.enum(GOOGLE_ACCOUNT_STATUSES);
export type GoogleAccountState = z.infer<typeof googleAccountStatusSchema>;

export const googleCapabilityStateSchema = z.object({
  key: googleCapabilitySchema,
  /** The grant covers every scope this capability needs. */
  granted: z.boolean(),
  /** Google classes one of its scopes as restricted: the platform needs Google's verification and a security assessment for it. */
  restricted: z.boolean(),
});
export type GoogleCapabilityState = z.infer<typeof googleCapabilityStateSchema>;

export const googleAccountResponseSchema = z.object({
  status: googleAccountStatusSchema,
  /** The connected Google account's email, also while it needs reconnecting. */
  account: z.string().nullable(),
  connectedAt: z.string().datetime().nullable(),
  /** One row per capability, in the order the page lists them. */
  capabilities: z.array(googleCapabilityStateSchema),
  /** The calendar bookings and Meet links are written to. */
  calendarId: z.string().nullable(),
  calendarName: z.string().nullable(),
  /** The last failure a feature met using the account (a stable GOOGLE_* code), cleared by the next success. */
  lastError: z
    .object({
      code: z.string(),
      at: z.string().datetime(),
      /** Which permission's call failed, when it is known. */
      capability: googleCapabilitySchema.nullable(),
    })
    .nullable(),
  /** The last time a flow node or a booking used the account. */
  lastUsedAt: z.string().datetime().nullable(),
});
export type GoogleAccountResponse = z.infer<typeof googleAccountResponseSchema>;

/** A path inside this app to land on after Google's consent screen: never a full URL (no open redirect). */
export const googleReturnPathSchema = z
  .string()
  .max(200)
  .regex(/^\/(?!\/)[^\s\\]*$/, 'must be a path inside the app');

export const googleConnectInputSchema = z.object({
  /** What to ask Google for now. A connected account keeps what it has and adds these. */
  capabilities: z.array(googleCapabilitySchema).min(1).max(5),
  returnTo: googleReturnPathSchema.optional(),
});
export type GoogleConnectInput = z.infer<typeof googleConnectInputSchema>;

export const googleConnectResponseSchema = z.object({
  /** Google's consent URL: send the browser there. */
  url: z.string().url(),
  expiresInSeconds: z.number().int(),
});
export type GoogleConnectResponse = z.infer<typeof googleConnectResponseSchema>;

/**
 * What the flow builder needs to know to warn about a Google node: whether the workspace's account is usable and which capabilities it
 * covers. No account email: any member who edits flows may read this.
 */
export const googleAccountSummarySchema = z.object({
  status: googleAccountStatusSchema,
  granted: z.array(googleCapabilitySchema),
});
export type GoogleAccountSummary = z.infer<typeof googleAccountSummarySchema>;
