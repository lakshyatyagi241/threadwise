/**
 * WhatsApp number extras (TW-WABA-023, 025, 027, 028): the business username, click-to-chat QR codes, the history re-sync and
 * the free-conversation allowance. Shapes that cross the network between the API and the health page.
 */
import { z } from 'zod';

/** `POST /v2/waba/numbers/:id/username`. The handle is trimmed and lower-cased server-side; Meta's own rules are checked there too. */
export const claimUsernameInputSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9._]+$/, 'Use lowercase letters, numbers, . and _ only'),
});
export type ClaimUsernameInput = z.infer<typeof claimUsernameInputSchema>;

export const wabaUsernameSchema = z.object({
  username: z.string().nullable(),
  /** `reserved`: held until WhatsApp rolls usernames out for the account. `approved`: visible to customers. */
  status: z.enum(['reserved', 'approved']).nullable(),
  /** Up to five valid handles built from Meta's reserved name and the brand name; empty once one is claimed. */
  suggestions: z.array(z.string()),
});
export type WabaUsername = z.infer<typeof wabaUsernameSchema>;

export const wabaQrCodeSchema = z.object({
  code: z.string(),
  prefilledMessage: z.string(),
  /** `https://wa.me/message/<code>` */
  deepLinkUrl: z.string().nullable(),
  qrImageUrl: z.string().nullable(),
});
export type WabaQrCode = z.infer<typeof wabaQrCodeSchema>;

export const wabaQrCodeListSchema = z.object({ items: z.array(wabaQrCodeSchema) });
export type WabaQrCodeList = z.infer<typeof wabaQrCodeListSchema>;

/** `POST /v2/waba/numbers/:id/qr-codes`: Meta caps the message at 140 characters. */
export const createQrCodeInputSchema = z.object({
  prefilledMessage: z.string().trim().min(1).max(140),
});
export type CreateQrCodeInput = z.infer<typeof createQrCodeInputSchema>;

/** `POST /v2/waba/numbers/:id/sync-history`: Meta pushes history once, shortly after onboarding; this re-asks and reports what arrived. */
export const wabaSyncHistoryResultSchema = z.object({
  requested: z.literal(true),
  importedMessages: z.number().int(),
  /** Whether the subscription now points at this platform (the only lever Meta offers). */
  inboundWired: z.boolean().nullable(),
  warnings: z.array(z.string()),
});
export type WabaSyncHistoryResult = z.infer<typeof wabaSyncHistoryResultSchema>;

/** The free monthly service-conversation allowance, from Meta's conversation analytics (TW-WABA-023). */
export const WABA_FREE_CONVERSATIONS_PER_MONTH = 1000;
export const wabaConversationsSchema = z.object({
  freeUsed: z.number().int(),
  freeTotal: z.number().int(),
  freeLeft: z.number().int(),
  paid: z.number().int(),
  total: z.number().int(),
  cost: z.number(),
});
export type WabaConversations = z.infer<typeof wabaConversationsSchema>;

// --- webhook diagnostics (TW-WABA-002, 003, 015) ---------------------------------------------------------------------

/** The webhook fields coexistence needs the platform's Meta app to be subscribed to. */
export const WABA_COEXISTENCE_FIELDS = [
  'messages',
  'smb_message_echoes',
  'smb_app_state_sync',
  'history',
] as const;

/** `GET /v2/platform/waba/webhook-status` and the result of `POST /v2/platform/waba/webhook-subscribe` (super admin). */
export const wabaWebhookStatusSchema = z.object({
  /** True only when all four coexistence fields are subscribed. */
  ok: z.boolean(),
  subscribed: z.array(z.string()),
  missing: z.array(z.string()),
  /** The callback Meta has on file for the app's WhatsApp object, when it has one. */
  callbackUrl: z.string().nullable(),
  /** Why the check could not be completed (no app id and secret, Meta refused, Meta unreachable); the lists are then empty. */
  error: z.string().nullable(),
  /** Set by the subscribe call once it succeeded and everything is present. */
  subscribedNow: z.boolean().optional(),
});
export type WabaWebhookStatus = z.infer<typeof wabaWebhookStatusSchema>;

export const wabaInboundVerdictSchema = z.enum([
  'not_subscribed',
  'wrong_url',
  'delivering_here',
  'subscribed_default',
]);
export type WabaInboundVerdict = z.infer<typeof wabaInboundVerdictSchema>;

/** `GET /v2/waba/numbers/:id/inbound-check`: what Meta actually delivers this number's events to (TW-WABA-015). */
export const wabaInboundCheckSchema = z.object({
  verdict: wabaInboundVerdictSchema,
  apps: z.array(z.object({ name: z.string().nullable(), callbackUrl: z.string().nullable() })),
  /** Stable keys the screen translates: `no_secret` (the number has no app secret and the platform has none, so a signed delivery cannot be proven). */
  notes: z.array(z.enum(['no_secret'])),
});
export type WabaInboundCheck = z.infer<typeof wabaInboundCheckSchema>;

/** `GET /v2/waba/webhook-config`: what to paste into a customer's own Meta app. */
export const wabaWebhookConfigSchema = z.object({
  webhookUrl: z.string().nullable(),
  verifyToken: z.string(),
  fields: z.array(z.string()),
});
export type WabaWebhookConfig = z.infer<typeof wabaWebhookConfigSchema>;
