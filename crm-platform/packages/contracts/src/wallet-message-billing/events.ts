import { z } from 'zod';

/**
 * The one internal event a channel emits when a provider reports on an outbound message (TW-WALLET-012). Channels and the send
 * pipelines translate their own webhooks into it; the billing engine is its only subscriber, so which status counts as billable
 * is decided once, here, instead of seven times in seven controllers.
 */
export const MESSAGE_DELIVERY_EVENT = 'message.delivery_reported';

export const walletDeliveryProviderSchema = z.enum(['waba', 'twilio', 'baileys']);
export type WalletDeliveryProvider = z.infer<typeof walletDeliveryProviderSchema>;

export const walletDeliveryStatusSchema = z.enum([
  'sent',
  'delivered',
  'read',
  'failed',
  'undelivered',
]);
export type WalletDeliveryStatus = z.infer<typeof walletDeliveryStatusSchema>;

export const walletDeliverySourceSchema = z.enum([
  'campaign',
  'broadcast',
  'scheduled',
  'chat',
  'flow',
  'auto_reply',
  'inbox',
  'api',
]);
export type WalletDeliverySource = z.infer<typeof walletDeliverySourceSchema>;

export const walletDeliveryReportedSchema = z.object({
  provider: walletDeliveryProviderSchema,
  providerMessageId: z.string().trim().min(1).max(191),
  status: walletDeliveryStatusSchema,
  /** The recipient's number; the country of the rate comes from it. */
  recipient: z.string().trim().max(40).nullable().optional(),
  /** The Meta pricing category, else the template's category; null for chat and flow sends. */
  category: z.string().trim().max(24).nullable().optional(),
  source: walletDeliverySourceSchema.nullable().optional(),
});
export type WalletDeliveryReported = z.infer<typeof walletDeliveryReportedSchema>;

/**
 * Which statuses charge. A message counts against the wallet from `sent` (every engine), so a sent-but-not-yet-delivered message is
 * never free and a run cannot spend money that is still in flight; `failed`/`undelivered` then gives the exact charge back.
 * (Reference charged WABA and Twilio only on delivered/read, and Baileys on sent.) Idempotent per message id: sent, delivered and
 * read of one message charge once.
 */
export function isBillableStatus(
  _provider: WalletDeliveryProvider,
  status: WalletDeliveryStatus,
): boolean {
  return status === 'sent' || status === 'delivered' || status === 'read';
}

export function isFailureStatus(status: WalletDeliveryStatus): boolean {
  return status === 'failed' || status === 'undelivered';
}
