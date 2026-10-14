import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Viber channels (TW-VIB-001, 002, 007). A channel is a Viber Public Account (bot) connected by pasting its authentication token; the
 * token is never returned.
 */

export const VIBER_TOKEN_MIN = 20;

export const connectViberChannelSchema = z.object({
  authToken: z
    .string()
    .trim()
    .min(
      VIBER_TOKEN_MIN,
      'That does not look like a Viber auth token. Copy the whole token from your bot.',
    )
    .max(255),
});
export type ConnectViberChannelInput = z.infer<typeof connectViberChannelSchema>;

export const viberChannelSchema = z.object({
  id: uuidSchema,
  /** Viber's own id for the account. */
  viberId: z.string().nullable(),
  name: z.string().nullable(),
  /** The account's address on viber.com (`viber.com/<uri>`). */
  uri: z.string().nullable(),
  avatar: z.string().nullable(),
  active: z.boolean(),
  connectedAt: z.string().datetime().nullable(),
  lastInboundAt: z.string().datetime().nullable(),
  /** Why the webhook or the last send failed; null when healthy. */
  lastError: z.string().nullable(),
  /** The address Viber pushes to for this channel (always https). */
  webhookUrl: z.string(),
  rowVersion: z.number().int(),
});
export type ViberChannelResponse = z.infer<typeof viberChannelSchema>;

export const connectViberChannelResponseSchema = viberChannelSchema.extend({
  /** Viber refused the webhook: the channel is saved and shows "needs attention"; this says why and how to fix it. */
  webhookError: z.string().nullable(),
});
export type ConnectViberChannelResponse = z.infer<typeof connectViberChannelResponseSchema>;

export const viberChannelListSchema = z.object({ data: z.array(viberChannelSchema) });
export type ViberChannelList = z.infer<typeof viberChannelListSchema>;
