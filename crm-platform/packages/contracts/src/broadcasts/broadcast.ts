import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Broadcasts (BCAST): one-shot bulk sends of a single template to a list of contacts.
 * Reference's `POST /broadcasts` is the entry point (TW-BCAST-009); the fields keep its meaning and are renamed to
 * our camelCase, with every id a uuid.
 */

/** `broadcasts.name` is validated to 255 in Reference. */
export const BROADCAST_NAME_MAX = 255;
/** Reference accepted `device_share` weights 0..1000; 0 and below fall back to 1 (equal share). */
export const BROADCAST_SHARE_MAX = 1000;

export const BROADCAST_SCHEDULE_TYPES = ['now', 'later'] as const;
export type BroadcastScheduleType = (typeof BROADCAST_SCHEDULE_TYPES)[number];

/** Statuses this slice writes. The runner and webhooks add the rest (TW-BCAST-025..027). */
export const BROADCAST_STATUSES = ['scheduled', 'processing'] as const;

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'sendDate must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'sendDate is not a real date');
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'sendTime must be HH:mm (24 hour)');

/**
 * A sender key picks one connected number: `<engine>:<uuid>` (engine = baileys, waba, twilio, sms). Reference also
 * accepted a bare integer for the workspace default engine; the uuid form replaces it.
 */
export const senderKeySchema = z.string().trim().min(1).max(64);

export const createBroadcastSchema = z
  .object({
    name: z.string().trim().min(1).max(BROADCAST_NAME_MAX),
    /** Required: Reference's form requires it and a template-less broadcast only ever fails per recipient. */
    templateId: uuidSchema,
    /** Send-time variable overrides from the mapping panel; sanitised by the template domain before it is stored. */
    templateOverrides: z.record(z.unknown()).nullish(),
    contactIds: z.array(uuidSchema).max(100_000).default([]),
    groupIds: z.array(uuidSchema).max(1_000).default([]),
    tagIds: z.array(uuidSchema).max(1_000).default([]),
    /** One broadcast row is created per sender; none picked = one sender-less broadcast on the default engine. */
    senderKeys: z.array(senderKeySchema).max(50).default([]),
    /** Audience split weights keyed by sender key; missing or non-positive means 1. */
    senderShare: z.record(senderKeySchema, z.number().min(0).max(BROADCAST_SHARE_MAX)).default({}),
    scheduleType: z.enum(BROADCAST_SCHEDULE_TYPES),
    sendDate: dateOnly.optional(),
    sendTime: timeOfDay.optional(),
    /** IANA zone the date and time are read in; Reference defaulted to UTC. */
    timezone: z.string().trim().min(1).max(64).default('UTC'),
  })
  .superRefine((v, ctx) => {
    if (v.scheduleType !== 'later') return;
    if (!v.sendDate)
      ctx.addIssue({
        code: 'custom',
        path: ['sendDate'],
        message: 'sendDate is required to schedule',
      });
    if (!v.sendTime)
      ctx.addIssue({
        code: 'custom',
        path: ['sendTime'],
        message: 'sendTime is required to schedule',
      });
  });
export type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;

export const broadcastResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  status: z.string(),
  provider: z.string().nullable(),
  /** The sender this slice is sent from, as `<engine>:<uuid>`; null for the sender-less broadcast. */
  senderKey: z.string().nullable(),
  templateId: uuidSchema.nullable(),
  timezone: z.string().nullable(),
  scheduledAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  totalRecipients: z.number().int(),
  successCount: z.number().int(),
  deliveredCount: z.number().int(),
  readCount: z.number().int(),
  clickedCount: z.number().int(),
  failCount: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BroadcastResponse = z.infer<typeof broadcastResponseSchema>;

export const createBroadcastResponseSchema = z.object({
  /** One per sender slice, in the order the senders were picked. */
  broadcasts: z.array(broadcastResponseSchema).min(1),
  devicesCount: z.number().int(),
});
export type CreateBroadcastResponse = z.infer<typeof createBroadcastResponseSchema>;
