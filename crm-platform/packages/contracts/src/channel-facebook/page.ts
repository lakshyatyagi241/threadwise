import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Facebook Pages (WD-FB-001 to 005). An account is connected once and every Page it manages is stored with its own access token.
 * The token is never returned; the Page card carries only what the hub shows.
 */

export const FB_PAGE_STATUSES = ['connected', 'disconnected', 'expired', 'error'] as const;
export const FB_CONNECT_METHODS = ['oauth', 'embedded', 'manual'] as const;

export const facebookPageSchema = z.object({
  id: uuidSchema,
  /** Meta's Page id. */
  pageId: z.string(),
  name: z.string().nullable(),
  category: z.string().nullable(),
  username: z.string().nullable(),
  pictureUrl: z.string().nullable(),
  fanCount: z.number().int().nullable(),
  /** `expired` means Meta revoked the token: the card shows "Reconnect needed". */
  status: z.enum(FB_PAGE_STATUSES),
  connectMethod: z.enum(FB_CONNECT_METHODS),
  lastError: z.string().nullable(),
  /** Meta's separate 90 day data-access clock; the hub warns before it lapses. */
  dataAccessExpiresAt: z.string().datetime().nullable(),
  /** What the Page's token may do (MANAGE, CREATE_CONTENT, MODERATE, MESSAGING, ANALYZE). */
  tasks: z.array(z.string()),
  createdAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type FacebookPage = z.infer<typeof facebookPageSchema>;

export const facebookPageListSchema = z.object({ data: z.array(facebookPageSchema) });
export type FacebookPageList = z.infer<typeof facebookPageListSchema>;

/** What the hub needs to start a connection (nothing secret: the app id is public). */
export const facebookConnectConfigSchema = z.object({
  /** False when no Meta app is configured: the hub explains that an administrator has to set it up. */
  configured: z.boolean(),
  appId: z.string().nullable(),
  /** A Login-for-Business configuration id, when set. */
  configId: z.string().nullable(),
  graphVersion: z.string(),
  /** The address to paste into the Meta app's webhook settings. */
  webhookUrl: z.string(),
});
export type FacebookConnectConfig = z.infer<typeof facebookConnectConfigSchema>;

export const startConnectResponseSchema = z.object({
  /** The Facebook login dialog the browser is sent to. */
  url: z.string().url(),
});
export type StartConnectResponse = z.infer<typeof startConnectResponseSchema>;

/** The popup's server-side code (exchanged without a redirect address). */
export const fbConnectEmbeddedSchema = z.object({ code: z.string().trim().min(1).max(2000) });
export type FbConnectEmbeddedInput = z.infer<typeof fbConnectEmbeddedSchema>;

/** A Page access token pasted by the operator. */
export const fbConnectManualSchema = z.object({
  pageAccessToken: z
    .string()
    .trim()
    .min(20, 'That does not look like a Page access token.')
    .max(1000),
});
export type FbConnectManualInput = z.infer<typeof fbConnectManualSchema>;

export const fbConnectResultSchema = z.object({
  pages: z.array(facebookPageSchema),
  /** "Facebook Page “X” connected." or "3 Facebook Pages connected: …". */
  message: z.string(),
});
export type FbConnectResult = z.infer<typeof fbConnectResultSchema>;

/** Refresh and "Fix inbound" answer with the Page; a refused re-subscribe is a field, not an HTTP error. */
export const facebookPageActionResultSchema = facebookPageSchema.extend({
  error: z.string().nullable(),
});
export type FacebookPageActionResult = z.infer<typeof facebookPageActionResultSchema>;
