/**
 * calling-voice: the call logging framework. Every call that is NOT a WhatsApp business call is recorded as a `call_log_entries` row:
 * logged by hand ("Log a call"), reported by the mobile app, reported by a telephony provider's signed callback, or confirmed after a
 * click-to-call from the web. The Call logs screen, the contact's calls and the contact timeline read these together with the WhatsApp
 * calls (`logs.ts`), told apart by `source`. See docs/specs/call-logging.md and docs/api/call-logging.md.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { cursorSchema } from '../common/pagination';

// --- vocabulary --------------------------------------------------------------------------------------------------------------

/** How a call reached the log. `whatsapp` is the existing `wa_calls` log; the other four are call log entries. */
export const CALL_ENTRY_SOURCES = [
  'manual',
  'telephony',
  'mobile_app',
  'web_click_to_call',
] as const;
export type CallEntrySource = (typeof CALL_ENTRY_SOURCES)[number];
export const CALL_LOG_SOURCES = ['whatsapp', ...CALL_ENTRY_SOURCES] as const;
export type CallLogSource = (typeof CALL_LOG_SOURCES)[number];
export const callLogSourceSchema = z.enum(CALL_LOG_SOURCES);

/** inbound: the customer called us. outbound: we called the customer. (The WhatsApp log uses the same two words.) */
export const CALL_ENTRY_DIRECTIONS = ['inbound', 'outbound'] as const;

/** What came of the call. */
export const CALL_OUTCOMES = [
  'connected',
  'no_answer',
  'busy',
  'left_voicemail',
  'wrong_number',
  'declined',
  'failed',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const callOutcomeSchema = z.enum(CALL_OUTCOMES);

export const CALL_NOTES_MAX = 2000;
/** The longest call an entry may record: a day. */
export const CALL_MAX_DURATION_SEC = 86_400;
/** A call may not start later than this many minutes from now (clocks differ)... */
export const CALL_FUTURE_TOLERANCE_MINUTES = 5;
/** ...nor earlier than this many days ago (a phone that was offline for a long time still catches up). */
export const CALL_MAX_AGE_DAYS = 400;
/** The most entries one mobile batch may carry. */
export const CALL_INGEST_MAX_BATCH = 100;
/** The longest a list row's notes preview runs. */
export const CALL_NOTES_PREVIEW_MAX = 140;

const startedAt = z.string().datetime({ offset: true });
const phoneText = z.string().trim().min(3).max(32);

// --- the entry as the API returns it -------------------------------------------------------------------------------------------

export const callLogEntrySchema = z.object({
  id: uuidSchema,
  source: z.enum(CALL_ENTRY_SOURCES),
  direction: z.enum(CALL_ENTRY_DIRECTIONS),
  outcome: callOutcomeSchema,
  startedAt: z.string(),
  durationSec: z.number().int().nonnegative(),
  contactId: uuidSchema.nullable(),
  contactName: z.string().nullable(),
  /** E.164 with the plus; null for a caller who withheld the number. */
  customerPhone: z.string().nullable(),
  ourPhone: z.string().nullable(),
  numberLabel: z.string().nullable(),
  handlerId: uuidSchema.nullable(),
  handlerName: z.string().nullable(),
  notes: z.string().nullable(),
  /** The entry points at a recording on the provider's side (the reference itself is never returned). */
  hasRecordingRef: z.boolean(),
  followUpTaskId: uuidSchema.nullable(),
  createdById: uuidSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rowVersion: z.number().int().positive(),
  /** The caller may edit or delete this entry now (their own manual entry inside the window, or call.logging.manage). */
  editable: z.boolean(),
});
export type CallLogEntry = z.infer<typeof callLogEntrySchema>;

// --- log a call --------------------------------------------------------------------------------------------------------------

/** A follow-up task made together with the call: its due time is required, the rest has defaults. */
export const logCallFollowUpSchema = z.object({
  /** Default "Follow up on the call with <contact>". */
  title: z.string().trim().min(1).max(200).optional(),
  dueAt: startedAt,
  /** An active member of the workspace. Omit for the person logging the call. */
  assigneeId: uuidSchema.optional(),
});
export type LogCallFollowUp = z.infer<typeof logCallFollowUpSchema>;

/**
 * `POST /v2/calls/log` ("Log a call"). Needs the contact, or the number to find the contact by. `startedAt` defaults to now minus the
 * duration. `source` is `manual`, or `web_click_to_call` when the form was opened by the "did you call? log it" nudge after a `tel:` click.
 * Logging records a fact: no consent rule refuses it.
 */
export const logCallInputSchema = z
  .object({
    contactId: uuidSchema.optional(),
    customerPhone: phoneText.optional(),
    direction: z.enum(CALL_ENTRY_DIRECTIONS),
    outcome: callOutcomeSchema,
    startedAt: startedAt.optional(),
    durationSec: z.number().int().min(0).max(CALL_MAX_DURATION_SEC).default(0),
    notes: z.string().trim().max(CALL_NOTES_MAX).optional(),
    ourPhone: phoneText.optional(),
    numberLabel: z.string().trim().max(80).optional(),
    source: z.enum(['manual', 'web_click_to_call']).default('manual'),
    /** A client's own id for this call (an offline queue, a double click): the same id again returns the first entry. */
    externalId: z.string().trim().min(1).max(100).optional(),
    followUp: logCallFollowUpSchema.optional(),
    /** Ask for the lifecycle stage suggestion in the answer. It is never applied for you. */
    suggestStageNudge: z.boolean().default(false),
  })
  .refine((v) => v.contactId !== undefined || v.customerPhone !== undefined, {
    message: 'Give the contact or the phone number.',
    path: ['contactId'],
  });
export type LogCallInput = z.infer<typeof logCallInputSchema>;

/** A suggestion the person may accept with a normal contact update. Nothing in the framework applies it. */
export const callNudgeSchema = z.object({
  kind: z.literal('lifecycle_stage'),
  current: z.string(),
  suggested: z.string(),
  suggestedLabel: z.string().nullable(),
});
export type CallNudge = z.infer<typeof callNudgeSchema>;

export const logCallResultSchema = z.object({
  entry: callLogEntrySchema,
  /** False when `externalId` named a call that was already logged: this is the first entry, unchanged. */
  created: z.boolean(),
  /** The contact was found by the phone number rather than named in the request. */
  matchedByPhone: z.boolean(),
  followUpTaskId: uuidSchema.nullable(),
  nudges: z.array(callNudgeSchema),
});
export type LogCallResult = z.infer<typeof logCallResultSchema>;

export const updateCallLogEntryInputSchema = z.object({
  outcome: callOutcomeSchema.optional(),
  direction: z.enum(CALL_ENTRY_DIRECTIONS).optional(),
  startedAt: startedAt.optional(),
  durationSec: z.number().int().min(0).max(CALL_MAX_DURATION_SEC).optional(),
  /** `null` clears the notes. */
  notes: z.string().trim().max(CALL_NOTES_MAX).nullable().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateCallLogEntryInput = z.infer<typeof updateCallLogEntryInputSchema>;

// --- the contact's calls -------------------------------------------------------------------------------------------------------

export const contactCallsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: cursorSchema.optional(),
  source: callLogSourceSchema.optional(),
});
export type ContactCallsQuery = z.infer<typeof contactCallsQuerySchema>;

// --- settings ------------------------------------------------------------------------------------------------------------------

export const CALL_EDIT_WINDOW_DEFAULT_HOURS = 24;
export const callLoggingSettingsSchema = z.object({
  /** Off by default: a call from a number nobody knows is not stored, so a personal call never creates a record about a stranger. */
  createContactsFromUnknownCallers: z.boolean(),
  /** How long the person who logged a call may still edit or delete it (1 to 720 hours). */
  editWindowHours: z.number().int().min(1).max(720),
  rowVersion: z.number().int().positive().nullable(),
  updatedAt: z.string().nullable(),
});
export type CallLoggingSettings = z.infer<typeof callLoggingSettingsSchema>;

export const updateCallLoggingSettingsInputSchema = z.object({
  createContactsFromUnknownCallers: z.boolean(),
  editWindowHours: z.number().int().min(1).max(720),
  /** Omit on the first save. */
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateCallLoggingSettingsInput = z.infer<typeof updateCallLoggingSettingsInputSchema>;

// --- the mobile app ------------------------------------------------------------------------------------------------------------

/**
 * What the phone's own call log calls a call (Android `CallLog.Calls.TYPE`). iOS has no call log API: the app asks the person after
 * the call and sends an explicit `outcome`.
 */
export const DEVICE_CALL_TYPES = [
  'incoming',
  'outgoing',
  'missed',
  'rejected',
  'blocked',
  'voicemail',
] as const;
export type DeviceCallType = (typeof DEVICE_CALL_TYPES)[number];

export const ingestCallEntrySchema = z.object({
  /** The device's own id of the call (Android: `CallLog.Calls._ID`; iOS: a UUID the app made when it asked the person). */
  deviceCallId: z.string().trim().min(1).max(100),
  direction: z.enum(CALL_ENTRY_DIRECTIONS),
  startedAt,
  durationSec: z.number().int().min(0).max(CALL_MAX_DURATION_SEC),
  customerPhone: phoneText,
  /** From the phone's call log. Ignored when `outcome` is given. */
  deviceCallType: z.enum(DEVICE_CALL_TYPES).optional(),
  /** What the person said about the call (the confirm-after-call prompt). Wins over `deviceCallType`. */
  outcome: callOutcomeSchema.optional(),
  /** The SIM or line the call used, when the app knows it. */
  ourPhone: phoneText.optional(),
  notes: z.string().trim().max(CALL_NOTES_MAX).optional(),
  /** The contact the person tapped, when the call was started from a contact screen. */
  contactId: uuidSchema.optional(),
});
export type IngestCallEntry = z.infer<typeof ingestCallEntrySchema>;

export const ingestCallsInputSchema = z.object({
  /** The install, stable across launches: with `deviceCallId` it makes the entry's identity. */
  deviceId: z.string().trim().min(1).max(64),
  platform: z.enum(['android', 'ios']),
  entries: z.array(ingestCallEntrySchema).min(1).max(CALL_INGEST_MAX_BATCH),
});
export type IngestCallsInput = z.infer<typeof ingestCallsInputSchema>;

export const INGEST_STATUSES = ['created', 'duplicate', 'ignored', 'rejected'] as const;
export const INGEST_REASONS = [
  /** The number matches no contact and the workspace does not create contacts from unknown callers: nothing was stored. */
  'unknown_number',
  /** The number cannot be read as a phone number. */
  'unusable_phone',
  /** The start time is in the future or older than the limit. */
  'invalid_time',
  /** The device blocked the call (spam filter): it is not a customer conversation. */
  'blocked',
  /** The named contact is not in this workspace. */
  'contact_not_found',
  /** The workspace's contact limit is reached and the caller would have been a new contact. */
  'contact_limit',
  'error',
] as const;
export type IngestReason = (typeof INGEST_REASONS)[number];

export const ingestResultSchema = z.object({
  /** The position of the entry in the request. */
  index: z.number().int().nonnegative(),
  status: z.enum(INGEST_STATUSES),
  id: uuidSchema.nullable(),
  contactId: uuidSchema.nullable(),
  reason: z.enum(INGEST_REASONS).nullable(),
});
export type IngestResult = z.infer<typeof ingestResultSchema>;

export const ingestCallsResultSchema = z.object({
  results: z.array(ingestResultSchema),
  counts: z.object({
    created: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
    ignored: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
});
export type IngestCallsResult = z.infer<typeof ingestCallsResultSchema>;

// --- telephony -----------------------------------------------------------------------------------------------------------------

export const telephonyProviderSchema = z.object({
  key: z.string(),
  label: z.string(),
  supportsClickToCall: z.boolean(),
});
export type TelephonyProviderInfo = z.infer<typeof telephonyProviderSchema>;

export const telephonyConnectionSchema = z.object({
  id: uuidSchema,
  provider: z.string(),
  label: z.string(),
  numbers: z.array(z.string()),
  status: z.enum(['active', 'disabled']),
  /** The last four characters of the secret, to tell two connections apart. The secret itself is shown once. */
  secretHint: z.string(),
  playsRecordingNotice: z.boolean(),
  lastEventAt: z.string().nullable(),
  /** Where the provider posts status callbacks (the path; the web puts the API's origin in front). */
  webhookPath: z.string(),
  createdAt: z.string(),
});
export type TelephonyConnection = z.infer<typeof telephonyConnectionSchema>;

export const createTelephonyConnectionInputSchema = z.object({
  provider: z.string().trim().min(2).max(32),
  label: z.string().trim().min(1).max(80),
  numbers: z
    .array(z.string().regex(/^\+[1-9]\d{6,14}$/, 'A number as E.164, e.g. +919876543210'))
    .max(20)
    .default([]),
  /** The workspace attests that its IVR or dialer plays the recording notice before recording. */
  playsRecordingNotice: z.boolean().default(false),
});
export type CreateTelephonyConnectionInput = z.infer<typeof createTelephonyConnectionInputSchema>;

export const updateTelephonyConnectionInputSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  numbers: z
    .array(z.string().regex(/^\+[1-9]\d{6,14}$/))
    .max(20)
    .optional(),
  playsRecordingNotice: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
export type UpdateTelephonyConnectionInput = z.infer<typeof updateTelephonyConnectionInputSchema>;

/** Creating or rotating shows the secret once: the provider (or the proxy in front of it) signs with it. */
export const telephonyConnectionSecretSchema = z.object({
  connection: telephonyConnectionSchema,
  secret: z.string(),
});
export type TelephonyConnectionSecret = z.infer<typeof telephonyConnectionSecretSchema>;

/**
 * `POST /v2/calls/click-to-call`: the workspace's telephony provider rings the person first, then the customer, and the finished call is
 * logged by the provider's callback (source `web_click_to_call`). A marketing call to a number on the Do-Not-Call list is refused.
 */
export const clickToCallInputSchema = z
  .object({
    connectionId: uuidSchema,
    contactId: uuidSchema.optional(),
    customerPhone: phoneText.optional(),
    /** Whose phone rings first. Default: the person's own number on their profile. */
    agentPhone: phoneText.optional(),
    /** `service`: a call about an order or a request. `marketing`: a sales or promotional call, which honours the Do-Not-Call list and a withdrawal. */
    purpose: z.enum(['service', 'marketing']).default('service'),
  })
  .refine((v) => v.contactId !== undefined || v.customerPhone !== undefined, {
    message: 'Give the contact or the phone number.',
    path: ['contactId'],
  });
export type ClickToCallInput = z.infer<typeof clickToCallInputSchema>;

export const clickToCallResultSchema = z.object({
  /** The provider's id for the call; the finished call arrives on the connection's callback under it. */
  callRef: z.string(),
  contactId: uuidSchema.nullable(),
});
export type ClickToCallResult = z.infer<typeof clickToCallResultSchema>;

/** `POST /v2/calls/check`: would a call to this contact or number be allowed, asked before dialling. Places nothing and changes nothing. */
export const callCheckInputSchema = z
  .object({
    contactId: uuidSchema.optional(),
    customerPhone: phoneText.optional(),
    purpose: z.enum(['service', 'marketing']).default('service'),
  })
  .refine((v) => v.contactId !== undefined || v.customerPhone !== undefined, {
    message: 'Give the contact or the phone number.',
    path: ['contactId'],
  });
export type CallCheckInput = z.infer<typeof callCheckInputSchema>;

export const callCheckResultSchema = z.object({
  decision: z.enum(['allow', 'deny', 'needs_notice']),
  /** The gate's reason: `on_dnc_list`, `withdrawn`, `subject_minor`, `no_consent_recorded`, ... Logging the call stays allowed whatever it says. */
  reason: z.string(),
});
export type CallCheckResult = z.infer<typeof callCheckResultSchema>;

// --- the signed callback -------------------------------------------------------------------------------------------------------

/** The headers of the generic signed callback. The signature is `v1=` + hex HMAC-SHA256 of `<timestamp>.<raw body>` with the connection's secret. */
export const TELEPHONY_TIMESTAMP_HEADER = 'x-telephony-timestamp';
export const TELEPHONY_SIGNATURE_HEADER = 'x-telephony-signature';
/** A callback whose timestamp is further than this from our clock is refused (replay window). */
export const TELEPHONY_REPLAY_WINDOW_SECONDS = 300;

export const TELEPHONY_CALL_STATUSES = [
  'completed',
  'no_answer',
  'busy',
  'failed',
  'canceled',
  'declined',
  'voicemail',
] as const;
export type TelephonyCallStatus = (typeof TELEPHONY_CALL_STATUSES)[number];

/** The body of the generic callback: one finished call. A provider adapter turns its own payload into this shape. */
export const telephonyCallEventSchema = z.object({
  /** The provider's id for this event (dedupe on retries). */
  id: z.string().min(1).max(200),
  type: z.literal('call.completed'),
  call: z.object({
    id: z.string().min(1).max(160),
    direction: z.enum(CALL_ENTRY_DIRECTIONS),
    status: z.enum(TELEPHONY_CALL_STATUSES),
    from: z.string().max(40).nullable().optional(),
    to: z.string().max(40).nullable().optional(),
    startedAt,
    durationSec: z.number().int().min(0).max(CALL_MAX_DURATION_SEC).default(0),
    recordingRef: z.string().max(500).nullable().optional(),
  }),
});
export type TelephonyCallEvent = z.infer<typeof telephonyCallEventSchema>;

// --- the web "did you call? log it" nudge --------------------------------------------------------------------------------------

/**
 * A `tel:` link click cannot be detected as a call, so the web asks afterwards. The web client remembers the click (`clickedAt`, the
 * contact or number) and, when the tab becomes visible again after at least `minAwaySeconds` and no more than `maxAgeMinutes`, offers the Log
 * a call form already filled with `callLogPrefill(...)`. Nothing is sent to the server until the person saves the form.
 */
export const CALL_CLICK_NUDGE = { minAwaySeconds: 15, maxAgeMinutes: 30 } as const;

export const callLogPrefillSchema = z.object({
  source: z.literal('web_click_to_call'),
  direction: z.literal('outbound'),
  contactId: uuidSchema.optional(),
  customerPhone: phoneText.optional(),
  startedAt,
});
export type CallLogPrefill = z.infer<typeof callLogPrefillSchema>;

/** The form values for the nudge: an outbound call that started when the link was clicked. */
export function callLogPrefill(click: {
  contactId?: string;
  customerPhone?: string;
  clickedAt: Date;
}): CallLogPrefill {
  return {
    source: 'web_click_to_call',
    direction: 'outbound',
    ...(click.contactId ? { contactId: click.contactId } : {}),
    ...(click.customerPhone ? { customerPhone: click.customerPhone } : {}),
    startedAt: click.clickedAt.toISOString(),
  };
}

/** Whether the nudge should show now, given when the link was clicked and when the tab was last away. */
export function shouldNudgeCall(awayMs: number, sinceClickMs: number): boolean {
  return (
    awayMs >= CALL_CLICK_NUDGE.minAwaySeconds * 1000 &&
    sinceClickMs <= CALL_CLICK_NUDGE.maxAgeMinutes * 60_000
  );
}
