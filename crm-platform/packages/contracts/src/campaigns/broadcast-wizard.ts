import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { senderKeySchema } from '../broadcasts/broadcast';
import { segmentRulesSchema } from '../segments/rules';
import { CAMPAIGN_STATUSES, campaignCountsSchema } from './campaign';
import {
  isIanaTimeZone,
  recurrenceRuleSchema,
  zonedTimeToUtc,
  type RecurrenceRule,
} from './recurrence';

/**
 * The "Create broadcast" wizard (an addition beyond Reference's `wa-campaigns` builder): four steps (template, audience, review,
 * test and send) that fill ONE draft, which is saved as the person goes and launched in the last step. Everything the screens and the
 * API exchange is defined here; the API validates with these same schemas and the web imports their types.
 *
 * The draft is the single source for the audience count and the send: `audience` is evaluated by one function on the server (groups
 * and segments joined, narrowed by `rules`, opted-out contacts and invalid numbers removed), so the number the person saw is the list
 * that is messaged.
 */

export const WIZARD_STEPS = ['template', 'audience', 'review', 'send'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
/** 1-based, as the stepper numbers them. */
export const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

export const WIZARD_NAME_MAX = 191;
/** Groups and segments a single broadcast may name. */
export const WIZARD_SOURCES_MAX = 100;
/** Test numbers per send. */
export const WIZARD_TEST_MAX_RECIPIENTS = 10;
/** A fixed variable value or a fallback: WhatsApp caps a body parameter at 1024 characters; stay well below. */
export const WIZARD_VARIABLE_TEXT_MAX = 200;
/** Contacts shown as a sample when the variables are resolved. */
export const WIZARD_SAMPLE_MAX = 5;
/** Retries run at exactly this spacing (hours): Meta's frequency cap lifts after a day. */
export const WIZARD_RETRY_INTERVAL_HOURS = 24;
/** Meta's "healthy ecosystem engagement" (frequency capping) error: the only one a retry is for. */
export const FREQUENCY_CAP_ERROR_CODE = '131049';

// ---------------------------------------------------------------------------------------- audience

/** Contacts one broadcast may name one by one (a longer list is a group, a segment or "all matching"). */
export const WIZARD_CONTACTS_MAX = 5000;
/** The CSV of the "Broadcast via CSV" mode: the file's size and its data rows. */
export const WIZARD_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const WIZARD_CSV_MAX_ROWS = 10_000;
/** The CSV template the audience step offers: a phone column and optional names (served by the API and built by the web from these). */
export const WIZARD_CSV_TEMPLATE_HEADERS = ['phone', 'first_name', 'last_name'] as const;
export const WIZARD_CSV_TEMPLATE_ROWS: ReadonlyArray<readonly string[]> = [
  ['+919812345678', 'Aarav', 'Sharma'],
  ['+919898765432', 'Priya', 'Patel'],
];
/** A parsed upload is kept this long unless a recurring broadcast pins it. */
export const WIZARD_CSV_TTL_DAYS = 7;
/** Rows per page the contacts table offers. */
export const WIZARD_CONTACT_PAGE_SIZES = [25, 50, 100] as const;

/** A parsed CSV upload as the draft refers to it: the id of the stored upload and the counts the person saw. */
export const wizardCsvRefSchema = z.object({
  id: uuidSchema,
  fileName: z.string().trim().max(255),
  valid: z.number().int().min(0),
  duplicate: z.number().int().min(0),
  invalid: z.number().int().min(0),
  optedOut: z.number().int().min(0),
});
export type WizardCsvRef = z.infer<typeof wizardCsvRefSchema>;

/** "Select all N matching" in the contacts table: everyone the search and the conditions found at that moment (frozen with the choice). */
export const wizardAllMatchingSchema = z.object({
  search: z.string().trim().max(100).nullable().default(null),
  rules: segmentRulesSchema.nullable().default(null),
});
export type WizardAllMatching = z.infer<typeof wizardAllMatchingSchema>;

/**
 * Who the broadcast goes to: the UNION of what each mode of the audience step holds, so a contact in two of them is messaged once.
 * Opted-out contacts and numbers WhatsApp cannot deliver to are always left out.
 */
export const wizardAudienceSchema = z.object({
  /** Contact groups (static lists); a contact in any of them is included. */
  groupIds: z.array(uuidSchema).max(WIZARD_SOURCES_MAX).default([]),
  /** Saved segments (rules that fill themselves); a contact in any of them is included. */
  segmentIds: z.array(uuidSchema).max(WIZARD_SOURCES_MAX).default([]),
  /**
   * The condition builder's filter of the contacts table (the same AND/OR rule tree a segment holds). It only decides which rows the
   * table shows; it joins the audience through `allMatching`.
   */
  rules: segmentRulesSchema.nullable().default(null),
  /** Contacts ticked one by one in the table. */
  contactIds: z.array(uuidSchema).max(WIZARD_CONTACTS_MAX).default([]),
  /** Contacts un-ticked after "select all matching". */
  excludedContactIds: z.array(uuidSchema).max(WIZARD_CONTACTS_MAX).default([]),
  /** Every contact the table's search and conditions matched when "select all matching" was chosen; null when it was not. */
  allMatching: wizardAllMatchingSchema.nullable().default(null),
  /** The valid numbers of an uploaded CSV. Numbers that are not contacts yet become contacts when the broadcast is launched. */
  csv: wizardCsvRefSchema.nullable().default(null),
});
export type WizardAudience = z.infer<typeof wizardAudienceSchema>;
export const EMPTY_WIZARD_AUDIENCE: WizardAudience = {
  groupIds: [],
  segmentIds: [],
  rules: null,
  contactIds: [],
  excludedContactIds: [],
  allMatching: null,
  csv: null,
};

/** Any one source makes an audience (the conditions alone do not: they only filter the contacts table). */
export const wizardAudienceHasSource = (a: WizardAudience): boolean =>
  a.groupIds.length > 0 ||
  a.segmentIds.length > 0 ||
  a.contactIds.length > 0 ||
  a.allMatching !== null ||
  a.csv !== null;

// ---------------------------------------------------------------------------------------- variables

/** `body.1` and `header.1` are the template's numbered placeholders, `button.0` the dynamic part of the first button's link. */
export const wizardSlotKeySchema = z
  .string()
  .regex(/^(?:(?:body|header)\.\d{1,2}|button\.\d{1,2})$/);

/** What a placeholder is filled with: a contact field or custom property (with a fallback for contacts that lack it), or fixed text. */
export const wizardVariableSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('field'),
    /** A contact field or property key (`first_name`, `email`, `city`): what the merge tags call it. */
    field: z.string().trim().min(1).max(100),
    /** Used when the contact has no value; empty means "send blank" is NOT allowed, the review step counts those contacts. */
    fallback: z.string().trim().max(WIZARD_VARIABLE_TEXT_MAX).nullish(),
  }),
  z.object({
    kind: z.literal('fixed'),
    text: z
      .string()
      .trim()
      .min(1)
      .max(WIZARD_VARIABLE_TEXT_MAX)
      // A fixed text is sent as it is: braces would be read as a merge tag by the send pipeline.
      .refine((v) => !/[{}]/.test(v), 'Braces are not allowed in a fixed value'),
  }),
]);
export type WizardVariableSource = z.infer<typeof wizardVariableSourceSchema>;

export const wizardVariablesSchema = z.record(wizardSlotKeySchema, wizardVariableSourceSchema);
export type WizardVariables = z.infer<typeof wizardVariablesSchema>;

/** Contact columns a placeholder can be filled from without a custom property. */
export const WIZARD_CONTACT_FIELDS = [
  'name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'mobile',
  'country_code',
  'address',
  'title',
  'language',
  'groups',
] as const;

// ---------------------------------------------------------------------------------------- schedule

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((v) => {
    const t = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v;
  }, 'is not a real date');
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm (24 hour)');
const zone = z.string().trim().min(1).max(64).refine(isIanaTimeZone, 'unknown time zone');

export const WIZARD_SCHEDULE_MODES = ['now', 'scheduled', 'recurring'] as const;

export const wizardScheduleSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('now') }),
  z.object({
    mode: z.literal('scheduled'),
    date: dateOnly,
    time: timeOfDay,
    timezone: zone,
  }),
  z.object({ mode: z.literal('recurring'), rule: recurrenceRuleSchema }),
]);
export type WizardSchedule = z.infer<typeof wizardScheduleSchema>;

/** Retries for messages Meta refuses for frequency capping (131049): the same message again every 24 hours, until the end date. */
export const wizardRetriesSchema = z.object({
  enabled: z.boolean().default(false),
  /** Last day a retry may start (the whole day counts), read in `timezone`. */
  endDate: dateOnly.nullish(),
  /** Defaults to the schedule's zone. */
  timezone: zone.nullish(),
});
export type WizardRetries = z.infer<typeof wizardRetriesSchema>;

// ---------------------------------------------------------------------------------------- the draft

export const wizardDraftSchema = z.object({
  /** Step 1. */
  name: z.string().trim().max(WIZARD_NAME_MAX).default(''),
  templateId: uuidSchema.nullable().default(null),
  /** The WhatsApp number it is sent from, as the broadcast composer keys it: `<engine>:<uuid>` (`waba:...`). Required to launch. */
  senderKey: senderKeySchema.nullable().default(null),
  /** Step 2. */
  audience: wizardAudienceSchema.default({}),
  /** Step 3. Keys are the template's placeholders. */
  variables: wizardVariablesSchema.default({}),
  /** Step 4. */
  schedule: wizardScheduleSchema.default({ mode: 'now' }),
  retries: wizardRetriesSchema.default({ enabled: false }),
  /** The furthest step the person reached (1 to 4), so a resumed draft opens where they stopped. */
  step: z.number().int().min(1).max(WIZARD_STEP_COUNT).default(1),
});
export type WizardDraft = z.infer<typeof wizardDraftSchema>;
export const EMPTY_WIZARD_DRAFT: WizardDraft = wizardDraftSchema.parse({});

/** Saving a draft takes whatever is filled in so far. */
export const saveWizardDraftSchema = wizardDraftSchema.partial();
export type SaveWizardDraftInput = z.infer<typeof saveWizardDraftSchema>;

export const updateWizardDraftSchema = saveWizardDraftSchema.extend({
  rowVersion: z.number().int().positive(),
});
export type UpdateWizardDraftInput = z.infer<typeof updateWizardDraftSchema>;

export const WIZARD_DRAFT_STATUSES = CAMPAIGN_STATUSES;
export const wizardDraftResponseSchema = z.object({
  /** The campaign (draft) row's uuid. */
  id: uuidSchema,
  status: z.enum(CAMPAIGN_STATUSES),
  draft: wizardDraftSchema,
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WizardDraftResponse = z.infer<typeof wizardDraftResponseSchema>;

// ---------------------------------------------------------------------------------------- step 1: templates

export const WIZARD_TEMPLATE_CATEGORIES = ['marketing', 'utility', 'authentication'] as const;

export const wizardTemplateSlotSchema = z.object({
  /** `body.1`, `header.1`, `button.0`. */
  slot: wizardSlotKeySchema,
  section: z.enum(['header', 'body', 'button']),
  /** The number in `{{n}}`, or the button's position. */
  position: z.number().int(),
  /** The merge key the template itself names for this placeholder (a default for the mapping). */
  key: z.string(),
  example: z.string().nullable(),
});
export type WizardTemplateSlot = z.infer<typeof wizardTemplateSlotSchema>;

/** An approved template as the wizard lists it, with what the preview and the variable step need. */
export const wizardTemplateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  language: z.string(),
  category: z.enum(WIZARD_TEMPLATE_CATEGORIES),
  header: z.string().nullable(),
  body: z.string(),
  footer: z.string().nullable(),
  buttons: z.array(z.record(z.unknown())),
  attachmentType: z.string().nullable(),
  attachmentUrl: z.string().nullable(),
  /** The WhatsApp number it is sent from. */
  senderLabel: z.string().nullable(),
  slots: z.array(wizardTemplateSlotSchema),
});
export type WizardTemplate = z.infer<typeof wizardTemplateSchema>;

export const wizardTemplatesResponseSchema = z.object({ data: z.array(wizardTemplateSchema) });
export type WizardTemplatesResponse = z.infer<typeof wizardTemplatesResponseSchema>;

// ---------------------------------------------------------------------------------------- step 2: audience

export const wizardGroupSourceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string().nullable(),
  memberCount: z.number().int(),
});
export const wizardSegmentSourceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string().nullable(),
  /** The last count we have (segments count themselves); null when none was computed yet. */
  memberCount: z.number().int().nullable(),
});
export const wizardAudienceSourcesSchema = z.object({
  groups: z.array(wizardGroupSourceSchema),
  segments: z.array(wizardSegmentSourceSchema),
});
export type WizardAudienceSources = z.infer<typeof wizardAudienceSourcesSchema>;

export const wizardAudienceCountRequestSchema = z.object({ audience: wizardAudienceSchema });
export type WizardAudienceCountRequest = z.infer<typeof wizardAudienceCountRequestSchema>;

export const wizardCountryCountSchema = z.object({
  /** ISO 3166-1 alpha-2; null when the number's prefix is unknown. */
  country: z.string().nullable(),
  count: z.number().int(),
});
export type WizardCountryCount = z.infer<typeof wizardCountryCountSchema>;

/** What the audience comes to, by the same rules the send applies. */
export const wizardAudienceCountSchema = z.object({
  /** Contacts the groups, segments and rules select. */
  matching: z.number().int(),
  /** Of those, never messaged: they opted out. */
  optedOut: z.number().int(),
  /** Of those, never messaged: no usable WhatsApp number. */
  invalidNumber: z.number().int(),
  /** Who will be messaged: matching minus the two above. */
  recipients: z.number().int(),
  /** Of the recipients, numbers from the CSV that are not contacts yet (they are created when the broadcast is launched). */
  newContacts: z.number().int().default(0),
  /** The database could not count in time: the numbers are the planner's estimate. */
  approximate: z.boolean(),
  /** Recipients by destination country, largest first (what the price follows). */
  countries: z.array(wizardCountryCountSchema),
  /** Conditions that point at something that was deleted: they match nothing until fixed. */
  invalidConditions: z.array(
    z.object({ path: z.string(), field: z.string(), reason: z.string(), message: z.string() }),
  ),
});
export type WizardAudienceCount = z.infer<typeof wizardAudienceCountSchema>;

// ---- the contacts table

export const wizardContactsQuerySchema = z.object({
  /** Matched against name, first and last name, email and phone, every word. */
  search: z.string().trim().max(100).nullish(),
  /** Conditions, evaluated by the segments rule engine on the server. */
  rules: segmentRulesSchema.nullish(),
  page: z.number().int().min(1).max(100_000).default(1),
  perPage: z.number().int().min(1).max(100).default(25),
});
export type WizardContactsQuery = z.infer<typeof wizardContactsQuerySchema>;

export const wizardContactRowSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  /** Opted out or without a usable number: shown, never selectable, never messaged. */
  sendable: z.boolean(),
  optedOut: z.boolean(),
});
export type WizardContactRow = z.infer<typeof wizardContactRowSchema>;

export const wizardContactsPageSchema = z.object({
  data: z.array(wizardContactRowSchema),
  /** Contacts matching the search and the conditions. */
  total: z.number().int(),
  /** The total is the planner's estimate (the count did not finish in time). */
  approximate: z.boolean(),
  page: z.number().int(),
  perPage: z.number().int(),
});
export type WizardContactsPage = z.infer<typeof wizardContactsPageSchema>;

// ---- the CSV upload

export const WIZARD_CSV_REJECT_REASONS = ['missing_phone', 'invalid_phone', 'duplicate'] as const;
export type WizardCsvRejectReason = (typeof WIZARD_CSV_REJECT_REASONS)[number];

export const wizardCsvReportSchema = z.object({
  /** The stored upload: what `audience.csv.id` carries. */
  id: uuidSchema,
  fileName: z.string(),
  totalRows: z.number().int(),
  /** Different numbers that passed the check (opted-out ones included). */
  valid: z.number().int(),
  /** Rows repeating a number already in the file (the first row is kept). */
  duplicate: z.number().int(),
  /** Rows without a number, or with one that is not a number WhatsApp can reach. */
  invalid: z.number().int(),
  /** Of the valid numbers, those of contacts who opted out: never messaged. */
  optedOut: z.number().int(),
  /** Of the valid numbers, those that are contacts already (matched by phone). */
  existing: z.number().int(),
  /** Of the valid numbers, those that become contacts at launch. */
  newContacts: z.number().int(),
  /** The first valid rows. */
  preview: z.array(
    z.object({
      line: z.number().int(),
      phone: z.string(),
      name: z.string().nullable(),
      status: z.enum(['new', 'existing', 'optedOut']),
    }),
  ),
  /** The first rejected rows (the whole list is the download). */
  issues: z.array(
    z.object({
      line: z.number().int(),
      value: z.string(),
      reason: z.enum(WIZARD_CSV_REJECT_REASONS),
    }),
  ),
  issuesTotal: z.number().int(),
  expiresAt: z.string().datetime().nullable(),
});
export type WizardCsvReport = z.infer<typeof wizardCsvReportSchema>;

// ---------------------------------------------------------------------------------------- step 3: review

export const wizardCreditCheckRequestSchema = z.object({
  templateId: uuidSchema,
  audience: wizardAudienceSchema,
});
export type WizardCreditCheckRequest = z.infer<typeof wizardCreditCheckRequestSchema>;

export const wizardCreditLineSchema = z.object({
  country: z.string().nullable(),
  messages: z.number().int(),
  /** One message to this country in this template's category, in the workspace's billing currency (hundredths). */
  unitPriceMinor: z.number().int(),
  subtotalMinor: z.number().int(),
});

export const wizardCreditCheckSchema = z.object({
  currency: z.string(),
  balanceMinor: z.number().int(),
  /** `plan`: the plan's monthly messages are free and the wallet pays beyond them. `wallet`: every delivered message is charged. */
  billingMode: z.enum(['plan', 'wallet']),
  category: z.enum(WIZARD_TEMPLATE_CATEGORIES),
  recipients: z.number().int(),
  /** Messages the wallet is charged for (the rest are covered by the plan's allowance). */
  chargeableMessages: z.number().int(),
  estimatedCostMinor: z.number().int(),
  lines: z.array(wizardCreditLineSchema),
  /** The wallet's own launch rule says this send may start. Sending is blocked when false. */
  sufficient: z.boolean(),
  /** How much more the wallet needs; 0 when sufficient. */
  shortfallMinor: z.number().int(),
  /** Where to add credit. */
  topupUrl: z.string(),
});
export type WizardCreditCheck = z.infer<typeof wizardCreditCheckSchema>;

export const wizardVariablePreviewRequestSchema = z.object({
  templateId: uuidSchema,
  audience: wizardAudienceSchema,
  variables: wizardVariablesSchema,
  /** How many real contacts to resolve the message for. */
  limit: z.number().int().min(1).max(WIZARD_SAMPLE_MAX).default(3),
});
export type WizardVariablePreviewRequest = z.infer<typeof wizardVariablePreviewRequestSchema>;

export const wizardSampleMessageSchema = z.object({
  contact: z.object({ id: uuidSchema, name: z.string().nullable(), phone: z.string().nullable() }),
  header: z.string().nullable(),
  body: z.string(),
  footer: z.string().nullable(),
  /** The value each placeholder took for this contact. */
  values: z.record(z.string()),
  /** Placeholders that came out empty for this contact (no value and no fallback). */
  empty: z.array(wizardSlotKeySchema),
});
export type WizardSampleMessage = z.infer<typeof wizardSampleMessageSchema>;

export const wizardVariablePreviewSchema = z.object({
  slots: z.array(wizardTemplateSlotSchema),
  /** Placeholders with no source: the review cannot continue until they have one. */
  unmapped: z.array(wizardSlotKeySchema),
  samples: z.array(wizardSampleMessageSchema),
});
export type WizardVariablePreview = z.infer<typeof wizardVariablePreviewSchema>;

// ---------------------------------------------------------------------------------------- step 4: test and send

export const wizardTestSendRequestSchema = z.object({
  /** The saved draft whose template and variables are sent. */
  draftId: uuidSchema,
  /** `+91xxxxxxxxxx,+91xxxxxxxxxx`: separated by commas, spaces or new lines. */
  recipients: z.string().trim().min(1).max(2000),
});
export type WizardTestSendRequest = z.infer<typeof wizardTestSendRequestSchema>;

export const WIZARD_TEST_STATUSES = ['sent', 'delivered', 'read', 'failed'] as const;

export const wizardTestResultSchema = z.object({
  id: uuidSchema,
  to: z.string(),
  status: z.enum(WIZARD_TEST_STATUSES),
  providerMessageId: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** What the wallet was charged for it (0 until delivery is reported, and when the plan covers it). */
  chargedMinor: z.number().int(),
  createdAt: z.string().datetime(),
});
export type WizardTestResult = z.infer<typeof wizardTestResultSchema>;

export const wizardTestSendResponseSchema = z.object({
  results: z.array(wizardTestResultSchema),
  /** The message as it went to the first number (what the sample contact would read). */
  renderedBody: z.string(),
});
export type WizardTestSendResponse = z.infer<typeof wizardTestSendResponseSchema>;

export const wizardTestLogSchema = z.object({ data: z.array(wizardTestResultSchema) });
export type WizardTestLog = z.infer<typeof wizardTestLogSchema>;

export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * `+91xxxxxxxxxx,+91xxxxxxxxxx` to numbers: split on commas, semicolons, spaces and new lines; the first of a repeat is kept.
 * `invalid` lists what is not E.164 and `tooMany` is true past WIZARD_TEST_MAX_RECIPIENTS. The wizard checks it while typing; the
 * API checks it again.
 */
export function parseTestRecipients(raw: string): {
  valid: string[];
  invalid: string[];
  tooMany: boolean;
} {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const v = part.trim();
    if (v === '' || seen.has(v)) continue;
    seen.add(v);
    (E164_PATTERN.test(v) ? valid : invalid).push(v);
  }
  return { valid, invalid, tooMany: valid.length > WIZARD_TEST_MAX_RECIPIENTS };
}

// ---------------------------------------------------------------------------------------- launch

export const wizardLaunchRequestSchema = z.object({
  /** The draft as the person last saw it: a launch of a draft that changed elsewhere is refused (409). */
  rowVersion: z.number().int().positive(),
});
export type WizardLaunchRequest = z.infer<typeof wizardLaunchRequestSchema>;

export const WIZARD_SERIES_STATUSES = ['active', 'paused', 'ended', 'cancelled'] as const;
export type WizardSeriesStatus = (typeof WIZARD_SERIES_STATUSES)[number];

export const wizardLaunchResultSchema = z.object({
  mode: z.enum(WIZARD_SCHEDULE_MODES),
  /** The campaign (now, scheduled) or the series (recurring) that now exists. */
  id: uuidSchema,
  kind: z.enum(['campaign', 'series']),
  status: z.string(),
  /** When the first run is due; null for "now" (it is queued). */
  firstRunAt: z.string().datetime().nullable(),
  recipients: z.number().int(),
  message: z.string(),
});
export type WizardLaunchResult = z.infer<typeof wizardLaunchResultSchema>;

// ---------------------------------------------------------------------------------------- list, detail, control

export const wizardRetrySummarySchema = z.object({
  enabled: z.boolean(),
  endDate: z.string().nullable(),
  /** Messages waiting for their next retry. */
  pending: z.number().int(),
  nextRetryAt: z.string().datetime().nullable(),
  /** Messages that failed for frequency capping and were delivered by a retry. */
  recovered: z.number().int(),
  /** Messages that were retried until the end date and never went through. */
  exhausted: z.number().int(),
});
export type WizardRetrySummary = z.infer<typeof wizardRetrySummarySchema>;

export const wizardRunSchema = z.object({
  id: uuidSchema,
  occurrence: z.number().int(),
  runAt: z.string().datetime().nullable(),
  status: z.enum(CAMPAIGN_STATUSES),
  counts: campaignCountsSchema,
  retries: wizardRetrySummarySchema,
});
export type WizardRun = z.infer<typeof wizardRunSchema>;

export const wizardBroadcastSchema = z.object({
  /** The campaign's or the series' uuid. */
  id: uuidSchema,
  kind: z.enum(['campaign', 'series']),
  name: z.string(),
  /** A campaign's status, or a series': active, paused, ended, cancelled. */
  status: z.string(),
  mode: z.enum(WIZARD_SCHEDULE_MODES),
  templateId: uuidSchema.nullable(),
  templateName: z.string().nullable(),
  /** The next time something is sent: a scheduled run, or the series' next occurrence. */
  nextRunAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
  /** Runs started so far (a series has one per occurrence; a campaign has one). */
  runs: z.number().int(),
  recipients: z.number().int(),
  retries: wizardRetrySummarySchema,
  schedule: wizardScheduleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type WizardBroadcast = z.infer<typeof wizardBroadcastSchema>;

export const wizardBroadcastDetailSchema = wizardBroadcastSchema.extend({
  draft: wizardDraftSchema,
  /** A series' runs, newest first (a one-off campaign lists itself). */
  runList: z.array(wizardRunSchema),
});
export type WizardBroadcastDetail = z.infer<typeof wizardBroadcastDetailSchema>;

export const listWizardBroadcastsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
  status: z.string().trim().max(32).optional(),
});
export type ListWizardBroadcastsQuery = z.infer<typeof listWizardBroadcastsQuerySchema>;

export const wizardBroadcastListSchema = z.object({
  data: z.array(wizardBroadcastSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
  }),
});
export type WizardBroadcastList = z.infer<typeof wizardBroadcastListSchema>;

export const wizardControlResponseSchema = z.object({
  id: uuidSchema,
  kind: z.enum(['campaign', 'series']),
  status: z.string(),
  message: z.string(),
});
export type WizardControlResponse = z.infer<typeof wizardControlResponseSchema>;

// ---------------------------------------------------------------------------------------- validation, shared by the steps and the launch

export interface WizardIssue {
  /** Dotted path in the draft (`name`, `audience`, `variables.body.1`, `schedule.date`). */
  path: string;
  /** A stable key the web maps to a translated message; the API returns it as the problem's `message`. */
  code:
    | 'name_required'
    | 'template_required'
    | 'sender_required'
    | 'audience_required'
    | 'variable_unmapped'
    | 'schedule_in_past'
    | 'schedule_end_before_start'
    | 'recurrence_invalid'
    | 'retry_end_required'
    | 'retry_end_before_send'
    | 'retry_end_in_past';
}

const ruleOf = (s: WizardSchedule): RecurrenceRule | null =>
  s.mode === 'recurring' ? s.rule : null;

/** The moment the first run is due, or null for "now". */
export function firstRunInstant(schedule: WizardSchedule): Date | null {
  if (schedule.mode === 'scheduled')
    return zonedTimeToUtc(schedule.date, schedule.time, schedule.timezone);
  const rule = ruleOf(schedule);
  return rule ? zonedTimeToUtc(rule.startDate, rule.timeOfDay, rule.timezone) : null;
}

/** The zone the draft's dates are read in: the schedule's own, else the retries', else UTC. */
export function draftTimeZone(d: Pick<WizardDraft, 'schedule' | 'retries'>): string {
  if (d.schedule.mode === 'scheduled') return d.schedule.timezone;
  if (d.schedule.mode === 'recurring') return d.schedule.rule.timezone;
  return d.retries.timezone ?? 'UTC';
}

/**
 * What is wrong with a draft at one step (1 to 4), as stable codes. The wizard calls it before Next; the API calls it for every
 * step at launch. `slots` are the template's placeholders (the draft does not carry them) and `now` the clock, passed in so the
 * function stays pure. Step 3's credit check is not here: it needs the wallet, so the screen and the launch ask the API.
 */
export function wizardStepIssues(
  step: 1 | 2 | 3 | 4,
  draft: WizardDraft,
  ctx: { slots?: readonly string[]; now: Date },
): WizardIssue[] {
  const out: WizardIssue[] = [];
  if (step === 1) {
    if (draft.name.trim() === '') out.push({ path: 'name', code: 'name_required' });
    if (draft.templateId === null) out.push({ path: 'templateId', code: 'template_required' });
    if (draft.senderKey === null) out.push({ path: 'senderKey', code: 'sender_required' });
  }
  if (step === 2) {
    if (!wizardAudienceHasSource(draft.audience))
      out.push({ path: 'audience', code: 'audience_required' });
  }
  if (step === 3) {
    for (const slot of ctx.slots ?? []) {
      if (!draft.variables[slot])
        out.push({ path: `variables.${slot}`, code: 'variable_unmapped' });
    }
  }
  if (step === 4) {
    const s = draft.schedule;
    if (s.mode === 'scheduled') {
      if (zonedTimeToUtc(s.date, s.time, s.timezone).getTime() <= ctx.now.getTime()) {
        out.push({ path: 'schedule.date', code: 'schedule_in_past' });
      }
    }
    if (s.mode === 'recurring') {
      const parsed = recurrenceRuleSchema.safeParse(s.rule);
      if (!parsed.success) out.push({ path: 'schedule.rule', code: 'recurrence_invalid' });
      else if (
        zonedTimeToUtc(s.rule.startDate, s.rule.timeOfDay, s.rule.timezone).getTime() <=
        ctx.now.getTime()
      ) {
        out.push({ path: 'schedule.rule.startDate', code: 'schedule_in_past' });
      }
    }
    if (draft.retries.enabled) {
      const end = draft.retries.endDate;
      if (!end) out.push({ path: 'retries.endDate', code: 'retry_end_required' });
      else {
        const zoneName = draft.retries.timezone ?? draftTimeZone(draft);
        // The whole of the end date counts, so the window closes at the start of the next day.
        const closes = zonedTimeToUtc(
          new Date(new Date(`${end}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10),
          '00:00',
          zoneName,
        );
        if (closes.getTime() <= ctx.now.getTime())
          out.push({ path: 'retries.endDate', code: 'retry_end_in_past' });
        const first = firstRunInstant(draft.schedule);
        if (first && closes.getTime() <= first.getTime()) {
          out.push({ path: 'retries.endDate', code: 'retry_end_before_send' });
        }
      }
    }
  }
  return out;
}

/** Every step's issues in order, for a launch. */
export function wizardLaunchIssues(
  draft: WizardDraft,
  ctx: { slots?: readonly string[]; now: Date },
): WizardIssue[] {
  return ([1, 2, 3, 4] as const).flatMap((s) => wizardStepIssues(s, draft, ctx));
}

/**
 * When a retry window closes (the start of the day after `endDate` in its zone): the API stops retrying a message once the next
 * retry would fall at or after this instant.
 */
export function retryWindowCloses(
  retries: { endDate?: string | null; timezone?: string | null },
  fallbackZone: string,
): Date | null {
  if (!retries.endDate) return null;
  const next = new Date(new Date(`${retries.endDate}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return zonedTimeToUtc(next, '00:00', retries.timezone ?? fallbackZone);
}

/** The instant of retry number `k` (1 is the first): the first send plus k whole days, never drifting with the time a run actually took. */
export function retryInstant(firstSentAt: Date, k: number): Date {
  return new Date(firstSentAt.getTime() + k * WIZARD_RETRY_INTERVAL_HOURS * 3_600_000);
}

// ---------------------------------------------------------------------------------------- step 1: senders

/** A connected WhatsApp number a broadcast can be sent from. */
export const wizardSenderSchema = z.object({
  /** `<engine>:<uuid>`. */
  key: senderKeySchema,
  label: z.string(),
  /** `+<digits>`, or empty when the number is not known. */
  phone: z.string(),
  engine: z.string(),
  engineLabel: z.string(),
  /** The workspace's default engine: the one preselected. */
  isDefault: z.boolean(),
});
export type WizardSender = z.infer<typeof wizardSenderSchema>;
export const wizardSendersResponseSchema = z.object({ data: z.array(wizardSenderSchema) });
export type WizardSendersResponse = z.infer<typeof wizardSendersResponseSchema>;
