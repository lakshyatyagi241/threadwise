import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Telegram bots (TW-TG-001, 002, 007). A bot is connected by pasting a @BotFather token; the token, the webhook secret and
 * the payment provider token are never returned, only whether a payment token is saved.
 */

/** What @BotFather hands out: digits, a colon, and a long token. */
export const BOT_TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;

export const connectBotSchema = z.object({
  botToken: z
    .string()
    .trim()
    .regex(
      BOT_TOKEN_PATTERN,
      'That does not look like a BotFather token. It should read like 123456789:AAH… — copy the whole line.',
    ),
});
export type ConnectBotInput = z.infer<typeof connectBotSchema>;

export const savePaymentSettingsSchema = z.object({
  /** Blank or absent keeps the saved token; a value replaces it. */
  paymentProviderToken: z.string().trim().max(191).optional(),
  paymentProvider: z.string().trim().max(32).optional(),
  /** Removes the saved token (ignored when a new one is sent). */
  clearPaymentToken: z.boolean().optional(),
});
export type SavePaymentSettingsInput = z.infer<typeof savePaymentSettingsSchema>;

export const botResponseSchema = z.object({
  id: uuidSchema,
  /** Telegram's own bot id. */
  botId: z.string().nullable(),
  username: z.string().nullable(),
  name: z.string().nullable(),
  active: z.boolean(),
  connectedAt: z.string().datetime().nullable(),
  lastInboundAt: z.string().datetime().nullable(),
  /** Why the webhook or the last send failed; null when healthy. */
  lastError: z.string().nullable(),
  hasPaymentToken: z.boolean(),
  paymentProvider: z.string().nullable(),
  /** The address Telegram pushes to for this bot (always https). */
  webhookUrl: z.string(),
  rowVersion: z.number().int(),
});
export type BotResponse = z.infer<typeof botResponseSchema>;

export const connectBotResponseSchema = botResponseSchema.extend({
  /** Telegram refused the webhook: the bot is saved and shows "needs attention"; this says why and how to fix it. */
  webhookError: z.string().nullable(),
});
export type ConnectBotResponse = z.infer<typeof connectBotResponseSchema>;

export const botListResponseSchema = z.object({ data: z.array(botResponseSchema) });
export type BotListResponse = z.infer<typeof botListResponseSchema>;
