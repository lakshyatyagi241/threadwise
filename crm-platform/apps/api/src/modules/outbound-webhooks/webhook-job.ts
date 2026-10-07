import type { WebhookEnvelope } from '@crm/contracts';

/** One delivery to be made: an event for one endpoint. The envelope is built once, so every retry carries the same `id`. */
export interface WebhookDeliveryJob {
  orgId: number;
  webhookId: number;
  envelope: WebhookEnvelope;
}

/** Retries after a failed attempt: 6 attempts in all, waiting 10 s, 20 s, 40 s, 80 s, 160 s between them. */
export const DELIVERY_ATTEMPTS = 6;
export const DELIVERY_BACKOFF_MS = 10_000;
