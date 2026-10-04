/**
 * scheduled-queue-warmer (SCHED): scheduled messages and the number warmer. Everything here crosses the network between the API and
 * the screens. See docs/wadesk-port/inventory/scheduled-queue-warmer.md and docs/api/scheduled-queue-warmer.md.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';

// --- vocabulary --------------------------------------------------------------------------------------------------------

export const SCHEDULE_TYPES = ['once', 'recurring'] as const;
export const REPEAT_INTERVALS = ['daily', 'weekly', 'monthly'] as const;
export const RECIPIENT_TYPES = ['group', 'tag', 'queue', 'number'] as const;
export const MESSAGE_TYPES = ['plain', 'template', 'media', 'location'] as const;
export const SCHEDULE_STATUSES = [
  'scheduled',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/** A schedule must be at least this far ahead (WD-SCHED-003 rule 2). */
export const SCHEDULE_MIN_LEAD_MINUTES = 2;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
/** 24 hour `HH:mm`, or 12 hour `h:mm AM`; the server normalises to 24 hour. */
const timeOfDay = z
  .string()
  .trim()
  .max(16)
  .regex(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/, 'Use a time such as 14:30 or 2:30 PM');

// --- create ------------------------------------------------------------------------------------------------------------

const createScheduleBase = z.object({
  name: z.string().trim().min(1).max(255),
  scheduleType: z.enum(SCHEDULE_TYPES),
  sendDate: dateOnly,
  sendTime: timeOfDay,
  /** An IANA zone such as `Asia/Kolkata`. */
  timezone: z.string().trim().min(1).max(64),
  repeatInterval: z.enum(REPEAT_INTERVALS).optional(),
  repeatEvery: z.number().int().min(1).max(365).optional(),
  /** 0 Sunday to 6 Saturday. Required for a weekly schedule. */
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  endDate: dateOnly.optional(),
  /** Sender keys `<engine>:<uuid>`. Two or more split the audience between them (WD-SCHED-005). */
  senders: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  messageType: z.enum(MESSAGE_TYPES),
  message: z.string().max(4096).optional(),
  templateId: uuidSchema.optional(),
  templateOverrides: z.record(z.unknown()).optional(),
  /** A link (https://...) to the file to send. Uploads come when the send port accepts file bytes. */
  media: z.string().trim().max(512).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  recipientType: z.enum(RECIPIENT_TYPES),
  groupIds: z.array(uuidSchema).max(200).optional(),
  tagIds: z.array(uuidSchema).max(200).optional(),
  /** Broadcast ids whose recipients are the audience. */
  queueIds: z.array(uuidSchema).max(200).optional(),
  numbers: z.array(z.string().trim().max(32)).max(5000).optional(),
  /** Also send the message to this number right away, to see it as the customer will (WD-SCHED-007). */
  testNumber: z.string().trim().max(32).optional(),
});

export const createScheduleInputSchema = createScheduleBase.superRefine((v, ctx) => {
  if (v.scheduleType === 'recurring') {
    if (!v.repeatInterval) {
      ctx.addIssue({
        code: 'custom',
        path: ['repeatInterval'],
        message: 'Choose how often it repeats.',
      });
    }
    if (v.repeatInterval === 'weekly' && !(v.daysOfWeek && v.daysOfWeek.length > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['daysOfWeek'],
        message: 'Choose the days of the week.',
      });
    }
  }
});
export type CreateScheduleInput = z.infer<typeof createScheduleInputSchema>;

/** The fields an edit may change, only while the schedule is waiting or paused (WD-SCHED-016): the recipients, sender, template and recurrence are fixed. */
export const updateScheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  sendDate: dateOnly.optional(),
  sendTime: timeOfDay.optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  message: z.string().max(4096).optional(),
  rowVersion: z.number().int().min(1),
});
export type UpdateScheduleInput = z.infer<typeof updateScheduleInputSchema>;

/** Retry a failed schedule at a new time (WD-SCHED-017). */
export const retryScheduleInputSchema = z.object({
  sendDate: dateOnly,
  sendTime: timeOfDay,
  timezone: z.string().trim().min(1).max(64).optional(),
});
export type RetryScheduleInput = z.infer<typeof retryScheduleInputSchema>;

// --- read --------------------------------------------------------------------------------------------------------------

export const scheduleSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  status: z.enum(SCHEDULE_STATUSES),
  scheduleType: z.enum(SCHEDULE_TYPES),
  recipientType: z.enum(RECIPIENT_TYPES),
  messageType: z.string(),
  senderLabel: z.string().nullable(),
  provider: z.string().nullable(),
  scheduledAt: z.string().datetime(),
  nextRunAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
  timezone: z.string(),
  repeatInterval: z.string().nullable(),
  totalRecipients: z.number().int(),
  totalSent: z.number().int(),
  totalDelivered: z.number().int(),
  totalFailed: z.number().int(),
  lastError: z.string().nullable(),
  /** Where it came from: `manual` (the composer) or a producer such as `cart_recovery` or `appointment_reminder`. */
  source: z.string().optional(),
  rowVersion: z.number().int(),
});
export type ScheduleSummary = z.infer<typeof scheduleSummarySchema>;

export const scheduleTabSchema = z.enum([
  'all',
  'upcoming',
  'running',
  'paused',
  'completed',
  'failed',
]);
export type ScheduleTab = z.infer<typeof scheduleTabSchema>;

export const listSchedulesQuerySchema = z.object({
  tab: scheduleTabSchema.default('all'),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListSchedulesQuery = z.infer<typeof listSchedulesQuerySchema>;

export const scheduleListSchema = z.object({
  items: z.array(scheduleSummarySchema),
  total: z.number().int(),
  stats: z.object({
    all: z.number().int(),
    upcoming: z.number().int(),
    running: z.number().int(),
    paused: z.number().int(),
    completed: z.number().int(),
    failed: z.number().int(),
  }),
  /** The next schedule to fire, for the "up next" strip. */
  upNext: scheduleSummarySchema.nullable(),
});
export type ScheduleList = z.infer<typeof scheduleListSchema>;

export const scheduleRecipientSchema = z.object({
  phone: z.string(),
  contactName: z.string().nullable(),
  status: z.enum(['pending', 'processing', 'sent', 'delivered', 'read', 'failed']),
  error: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  readAt: z.string().datetime().nullable(),
});

export const scheduleDetailSchema = scheduleSummarySchema.extend({
  message: z.string().nullable(),
  media: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  repeatEvery: z.number().int(),
  daysOfWeek: z.array(z.number().int()),
  endDate: z.string().nullable(),
  sendDate: z.string(),
  sendTime: z.string(),
  failureReason: z.string().nullable(),
  sendAttempts: z.number().int(),
  /** Counts by recipient status, from the recipient rows. */
  breakdown: z.record(z.number().int()),
  recipients: z.array(scheduleRecipientSchema),
  recipientsTruncated: z.boolean(),
});
export type ScheduleDetail = z.infer<typeof scheduleDetailSchema>;

/** What the composer needs to draw its pickers. */
export const scheduleOptionsSchema = z.object({
  senders: z.array(
    z.object({
      key: z.string(),
      engine: z.string(),
      label: z.string(),
      phone: z.string().nullable(),
      warming: z.boolean(),
    }),
  ),
  groups: z.array(z.object({ id: uuidSchema, name: z.string(), members: z.number().int() })),
  tags: z.array(z.object({ id: uuidSchema, name: z.string(), contacts: z.number().int() })),
  queues: z.array(z.object({ id: uuidSchema, name: z.string(), recipients: z.number().int() })),
  templates: z.array(z.object({ id: uuidSchema, name: z.string(), language: z.string() })),
  minLeadMinutes: z.number().int(),
});
export type ScheduleOptions = z.infer<typeof scheduleOptionsSchema>;

/** Who a draft would reach, before saving (the composer's review step). */
export const previewAudienceInputSchema = createScheduleBase.pick({
  recipientType: true,
  groupIds: true,
  tagIds: true,
  queueIds: true,
  numbers: true,
});
export const audiencePreviewSchema = z.object({
  total: z.number().int(),
  optedOut: z.number().int(),
  sample: z.array(z.string()),
});
export type AudiencePreview = z.infer<typeof audiencePreviewSchema>;

export const createScheduleResultSchema = z.object({
  /** One id per sender when the audience was split. */
  ids: z.array(uuidSchema),
  sendersCount: z.number().int(),
  totalRecipients: z.number().int(),
  message: z.string(),
  testSent: z.boolean().nullable(),
  testError: z.string().nullable(),
});
export type CreateScheduleResult = z.infer<typeof createScheduleResultSchema>;

// --- warmer ------------------------------------------------------------------------------------------------------------

/** WaDesk's shipped defaults: a conservative ramp (WarmerService::DEFAULTS). */
export const WARMER_DEFAULTS = {
  enabled: false,
  dailyBase: 20,
  stepPct: 20,
  stepDays: 3,
  maxDaily: 500,
  gapMin: 15,
  gapMax: 45,
  activeStart: 9,
  activeEnd: 21,
  spintax: false,
} as const;

export const warmerProfileInputSchema = z
  .object({
    enabled: z.boolean(),
    dailyBase: z.number().int().min(1).max(5000),
    stepPct: z.number().int().min(0).max(200),
    stepDays: z.number().int().min(1).max(60),
    maxDaily: z.number().int().min(1).max(100000),
    gapMin: z.number().int().min(0).max(3600),
    gapMax: z.number().int().min(0).max(3600),
    activeStart: z.number().int().min(0).max(23),
    activeEnd: z.number().int().min(0).max(24),
    spintax: z.boolean(),
  })
  .refine((v) => v.maxDaily >= v.dailyBase, {
    path: ['maxDaily'],
    message: 'The ceiling cannot be below the first day budget.',
  });
export type WarmerProfileInput = z.infer<typeof warmerProfileInputSchema>;

export const warmerNumberSchema = z.object({
  key: z.string(),
  engine: z.string(),
  label: z.string(),
  phone: z.string().nullable(),
  status: z.string(),
  profile: warmerProfileInputSchema,
  startedAt: z.string().nullable(),
  /** Today's ramped budget, what was sent or reserved today, and what is left. */
  budget: z.number().int(),
  sentToday: z.number().int(),
  remaining: z.number().int(),
  health: z.number().int().min(0).max(100),
});
export type WarmerNumber = z.infer<typeof warmerNumberSchema>;

export const warmerListSchema = z.object({
  items: z.array(warmerNumberSchema),
  defaults: warmerProfileInputSchema,
});
export type WarmerList = z.infer<typeof warmerListSchema>;
