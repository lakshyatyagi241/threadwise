/**
 * webhook-fanout (WFWD): the platform operator's list of targets the one Meta webhook is forwarded to, and the failed
 * deliveries kept for replay. Not a Reference feature: Meta allows one callback URL per app, so we multiplex it.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';

export * from './errors';

const nameSchema = z.string().trim().min(1).max(80);
const urlSchema = z.string().trim().url().max(2000);
const headerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9-]+$/, 'Header names use letters, digits and dashes');
const fieldSchema = z.string().trim().min(1).max(80);

export const webhookTargetItemSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  url: z.string(),
  isActive: z.boolean(),
  authHeaderName: z.string().nullable(),
  /** A header value is saved. The value itself is write-only. */
  hasAuthHeader: z.boolean(),
  authHeaderLast4: z.string().nullable(),
  /** Empty = every field. */
  fieldFilter: z.array(z.string()),
  timeoutMs: z.number().int(),
  maxAttempts: z.number().int(),
  successCount: z.number().int(),
  failureCount: z.number().int(),
  lastStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  /** Failed deliveries still waiting for a replay. */
  pendingFailures: z.number().int(),
  rowVersion: z.number().int(),
  updatedAt: z.string(),
});
export type WebhookTargetItem = z.infer<typeof webhookTargetItemSchema>;

export const webhookTargetsResponseSchema = z.object({ data: z.array(webhookTargetItemSchema) });
export type WebhookTargetsResponse = z.infer<typeof webhookTargetsResponseSchema>;

export const createWebhookTargetSchema = z
  .object({
    name: nameSchema,
    url: urlSchema,
    isActive: z.boolean().default(true),
    authHeaderName: headerNameSchema.optional(),
    authHeaderValue: z.string().min(1).max(500).optional(),
    fieldFilter: z.array(fieldSchema).max(50).default([]),
    timeoutMs: z.number().int().min(1000).max(30000).default(10000),
    maxAttempts: z.number().int().min(1).max(10).default(5),
  })
  .refine((v) => Boolean(v.authHeaderName) === Boolean(v.authHeaderValue), {
    message: 'A header needs both a name and a value',
    path: ['authHeaderValue'],
  });
export type CreateWebhookTargetInput = z.infer<typeof createWebhookTargetSchema>;

export const updateWebhookTargetSchema = z.object({
  rowVersion: z.number().int().min(1),
  name: nameSchema.optional(),
  url: urlSchema.optional(),
  isActive: z.boolean().optional(),
  /** Blank value keeps the saved one; to change only the value send the same name with a new value. */
  authHeaderName: headerNameSchema.nullable().optional(),
  authHeaderValue: z.string().min(1).max(500).optional(),
  removeAuthHeader: z.boolean().optional(),
  fieldFilter: z.array(fieldSchema).max(50).optional(),
  timeoutMs: z.number().int().min(1000).max(30000).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
});
export type UpdateWebhookTargetInput = z.infer<typeof updateWebhookTargetSchema>;

export const webhookFailureItemSchema = z.object({
  id: uuidSchema,
  targetId: uuidSchema,
  targetName: z.string(),
  attempts: z.number().int(),
  statusCode: z.number().int().nullable(),
  error: z.string().nullable(),
  bodyBytes: z.number().int(),
  createdAt: z.string(),
  replayedAt: z.string().nullable(),
});
export type WebhookFailureItem = z.infer<typeof webhookFailureItemSchema>;

export const webhookFailuresQuerySchema = z.object({
  targetId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type WebhookFailuresQuery = z.infer<typeof webhookFailuresQuerySchema>;

export const webhookFailuresResponseSchema = z.object({ data: z.array(webhookFailureItemSchema) });
export type WebhookFailuresResponse = z.infer<typeof webhookFailuresResponseSchema>;

/** Result of a test send or a replay: what the target answered, within the target's own timeout. */
export const webhookDeliveryResultSchema = z.object({
  ok: z.boolean(),
  statusCode: z.number().int().nullable(),
  error: z.string().nullable(),
  latencyMs: z.number().int(),
});
export type WebhookDeliveryResult = z.infer<typeof webhookDeliveryResultSchema>;
