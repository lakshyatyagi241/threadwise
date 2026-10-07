/**
 * outbound-webhooks (API): a workspace's own webhook endpoints (Settings > Integrations > Webhooks). Each endpoint subscribes to
 * events and receives signed JSON POSTs. See docs/wadesk-port/inventory/developer-rest-api-v1.md (WD-API-140 to 148).
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * The events a webhook can subscribe to. Names are WaDesk's style (snake_case). Only events the product already records are listed;
 * the message and broadcast delivery events of WaDesk's catalogue join once their producers exist (see the parity notes).
 */
export const WEBHOOK_EVENTS = [
  'contact_created',
  'contact_updated',
  'contact_deleted',
  'contact_tag_added',
  'contact_opted_in',
  'deal_stage_changed',
  'task_created',
  'task_assigned',
  'template_status_changed',
  'device_status_changed',
  'conversation_reopened',
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];
export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);

/** `*` stands for every event. */
export const WEBHOOK_ALL = '*';

export const WEBHOOK_NAME_MAX = 191;
export const WEBHOOK_URL_MAX = 2048;
export const WEBHOOK_SECRET_MAX = 191;

const eventsField = z
  .array(z.union([webhookEventSchema, z.literal(WEBHOOK_ALL)]))
  .max(WEBHOOK_EVENTS.length + 1);

export const createWebhookSchema = z.object({
  name: z.string().trim().max(WEBHOOK_NAME_MAX).optional(),
  url: z.string().trim().min(1).max(WEBHOOK_URL_MAX),
  /** Left out or empty: every event. */
  events: eventsField.default([]),
  /** The HMAC key that signs each delivery; never returned. */
  secret: z.string().max(WEBHOOK_SECRET_MAX).optional(),
  active: z.boolean().default(true),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

/**
 * No `rowVersion` here, on purpose: the endpoint's health counters are written on the same row after every delivery, so its version
 * moves all the time and a version check would reject nearly every edit. Edits to the settings are last-write-wins.
 */
export const updateWebhookSchema = z
  .object({
    name: z.string().trim().max(WEBHOOK_NAME_MAX).nullable().optional(),
    url: z.string().trim().min(1).max(WEBHOOK_URL_MAX).optional(),
    events: eventsField.optional(),
    /** Sets a new signing secret. */
    secret: z.string().max(WEBHOOK_SECRET_MAX).optional(),
    /** Removes the signing secret (deliveries then go unsigned). */
    clearSecret: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => !(v.secret && v.clearSecret), {
    message: 'secret and clearSecret cannot be combined',
    path: ['clearSecret'],
  });
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

export const webhookResponseSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  url: z.string(),
  /** The subscribed events, or `["*"]`. */
  events: z.array(z.string()),
  active: z.boolean(),
  /** Whether deliveries are signed; the secret itself is never sent back. */
  hasSecret: z.boolean(),
  /** The last delivery (after its retries) failed. */
  isFailing: z.boolean(),
  successCount: z.number().int(),
  failureCount: z.number().int(),
  lastStatusCode: z.number().int().nullable(),
  lastLatencyMs: z.number().int().nullable(),
  lastFiredAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type WebhookResponse = z.infer<typeof webhookResponseSchema>;

export const listWebhooksResponseSchema = z.object({
  data: z.array(webhookResponseSchema),
  availableEvents: z.array(webhookEventSchema),
});
export type ListWebhooksResponse = z.infer<typeof listWebhooksResponseSchema>;

export const webhookDeliveryResponseSchema = z.object({
  id: z.string(),
  event: z.string(),
  statusCode: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  attempts: z.number().int(),
  isRetry: z.boolean(),
  error: z.string().nullable(),
  firedAt: z.string().datetime(),
});
export type WebhookDeliveryResponse = z.infer<typeof webhookDeliveryResponseSchema>;

export const listWebhookDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListWebhookDeliveriesQuery = z.infer<typeof listWebhookDeliveriesQuerySchema>;

export const listWebhookDeliveriesResponseSchema = z.object({
  data: z.array(webhookDeliveryResponseSchema),
});
export type ListWebhookDeliveriesResponse = z.infer<typeof listWebhookDeliveriesResponseSchema>;

export const testWebhookResponseSchema = z.object({ delivery: webhookDeliveryResponseSchema });
export type TestWebhookResponse = z.infer<typeof testWebhookResponseSchema>;

/** The body of every delivery (JSON). `id` is stable across retries, so a receiver can ignore a repeat. */
export const webhookEnvelopeSchema = z.object({
  id: z.string(),
  event: z.string(),
  createdAt: z.string().datetime(),
  data: z.record(z.unknown()),
});
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

/** Headers on every delivery. */
export const WEBHOOK_HEADERS = {
  event: 'x-webhook-event',
  id: 'x-webhook-id',
  timestamp: 'x-webhook-timestamp',
  signature: 'x-webhook-signature',
} as const;
