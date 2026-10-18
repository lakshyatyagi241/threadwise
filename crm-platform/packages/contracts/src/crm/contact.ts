import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema } from '../common/ids';
import { birthDateSchema } from '../contact-consent/age';
import { lifecycleStageSchema, recordLifecycleSchema } from '../common/enums';
import { paginationQuerySchema } from '../common/pagination';
import { contactFilterShape } from '../contacts-attributes-tags/contact-filter';
import { consentProofSchema } from '../contact-consent/intake';
import { contactGroupRefSchema } from '../contacts-attributes-tags/contact-group';
import { contactTimezoneSchema, contactTimezoneSourceSchema } from './contact-timezone';
import { queryBoolean, queryList } from '../contacts-attributes-tags/query-helpers';
import type { InvalidCondition } from '../segments/rules';

/**
 * Contact — the reference vertical slice.
 *
 * Every other module copies this file's shape: a Response schema, a Create
 * schema, an Update schema (with `rowVersion` for optimistic locking) and a
 * List query schema.
 *
 * `customFields` is the Tier-2 escape hatch. Its keys are defined per-org in
 * the `fields` metadata table, so it cannot be typed statically here — the
 * API validates it at runtime against that org's field definitions.
 */
export const contactResponseSchema = z.object({
  id: uuidSchema,
  displayId: z.string().nullable(),
  name: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  companyId: uuidSchema.nullable(),
  ownerId: uuidSchema.nullable(),
  lifecycleState: recordLifecycleSchema,
  lifecycleStage: z.string().nullable(),
  /** When the current lifecycleStage was set — server-maintained, never client-set. */
  lifecycleStageDate: z.string().datetime().nullable(),
  previousLifecycleStage: z.string().nullable(),
  previousLifecycleStageDate: z.string().datetime().nullable(),
  status: z.string().nullable(),
  /** Meaningful only when status is a "closed lost" value. Options via status_options. */
  lostReason: z.string().nullable(),
  otherLostReason: z.string().nullable(),
  /** Stamped when the contact enters a won / lost lifecycle stage (Contact stages screen), cleared when it leaves. */
  wonAt: z.string().datetime().nullable(),
  lostAt: z.string().datetime().nullable(),
  leadScore: z.number().int().nullable(),
  /** Who set the score: a person ('manual', or null on a score typed before AI scoring existed) or the AI lead scorer ('ai'). */
  leadScoreSource: z.enum(['manual', 'ai']).nullable(),
  /** For an AI score: the short reasons the model gave. */
  leadScoreReasons: z.array(z.string()).nullable(),
  leadScoredAt: z.string().datetime().nullable(),
  leadScoreModel: z.string().nullable(),
  /** Values are org-configurable via status_options, not a fixed enum here. */
  whatsappSubscriptionStatus: z.string().nullable(),
  smsSubscriptionStatus: z.string().nullable(),
  emailSubscriptionStatus: z.string().nullable(),
  emailConfirmed: z.boolean(),
  faxNumber: z.string().nullable(),
  /** Built-in personal property (BL-217): `YYYY-MM-DD`, or null. A date that makes the contact a minor sets the minor flag (source `dob`). */
  dateOfBirth: z.string().nullable(),
  /** The contact is flagged as a minor (BL-190). Server-derived from the privacy flags; set through the Consent card or `POST /v1/contacts/:id/privacy`. */
  isMinor: z.boolean(),
  /** Bumped by note/activity/meeting writes — server-maintained. */
  lastActivityAt: z.string().datetime().nullable(),
  customFields: z.record(z.unknown()),
  /** Where the contact came from: the import's source knob, "import", an API client... */
  source: z.string().nullable(),
  /** The contact's own IANA time zone (BL-193): the quiet hours are read on it. Null: read from the number's country, then the workspace. */
  timezone: z.string().nullable(),
  /** Who set `timezone`: a person in the app (`staff`), a CSV `import` or the REST `api`. Null when no zone is stored. */
  timezoneSource: contactTimezoneSourceSchema.nullable(),
  /** Marketing opt-out (TW-CON-017). */
  isUnsubscribed: z.boolean(),
  isArchived: z.boolean(),
  /** Only when the request asked for them with `expand`. */
  groups: z.array(contactGroupRefSchema).optional(),
  tags: z
    .array(z.object({ id: uuidSchema, name: z.string(), color: z.string().nullable() }))
    .optional(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContactResponse = z.infer<typeof contactResponseSchema>;

export const createContactSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    firstName: z.string().min(1).max(255).optional(),
    lastName: z.string().min(1).max(255).optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    companyId: uuidSchema.optional(),
    /** Omitted: the creator. `null`: nobody (refused to a caller whose record scope would hide the contact). */
    ownerId: uuidSchema.nullish(),
    lifecycleStage: lifecycleStageSchema.or(z.string().min(1)).optional(),
    status: z.string().max(64).optional(),
    lostReason: z.string().max(255).optional(),
    otherLostReason: z.string().max(500).optional(),
    leadScore: z.number().int().min(0).max(100).optional(),
    whatsappSubscriptionStatus: z.string().max(64).optional(),
    smsSubscriptionStatus: z.string().max(64).optional(),
    emailSubscriptionStatus: z.string().max(64).optional(),
    emailConfirmed: z.boolean().optional(),
    faxNumber: z.string().max(32).optional(),
    /** `YYYY-MM-DD`; a real date of birth, not in the future. */
    dateOfBirth: birthDateSchema.optional(),
    /** Where the contact came from (TW-CON-015): a form, a campaign, "api". Free text. */
    source: z.string().trim().max(128).optional(),
    /** The contact's own IANA time zone (BL-193), e.g. `Asia/Kolkata`; recorded as set by whoever makes the contact. */
    timezone: contactTimezoneSchema.optional(),
    /** Marketing opt-out (TW-CON-017): broadcasts and campaigns skip an opted-out contact. */
    isUnsubscribed: z.boolean().optional(),
    /**
     * The proof that the person agreed to marketing. A subscription status set to `subscribed` needs it (422 CONSENT_NOTE_REQUIRED
     * without a note or text): the status alone is a label, the ledger grant written from this block is the consent. Not stored on the
     * contact.
     */
    consent: consentProofSchema.optional(),
    customFields: z.record(z.unknown()).default({}),
  })
  // A contact with neither a phone nor an email cannot be reached, cannot be
  // deduplicated, and cannot be resolved from an inbound message. Reject it.
  .refine((v) => Boolean(v.email || v.phone), {
    message: 'contact requires at least one of: email, phone',
    path: ['email'],
  });
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z.object({
  name: z.string().min(1).max(255).nullish(),
  firstName: z.string().min(1).max(255).nullish(),
  lastName: z.string().min(1).max(255).nullish(),
  email: emailSchema.nullish(),
  phone: phoneSchema.nullish(),
  companyId: uuidSchema.nullish(),
  ownerId: uuidSchema.nullish(),
  lifecycleStage: z.string().min(1).nullish(),
  status: z.string().max(64).nullish(),
  lostReason: z.string().max(255).nullish(),
  otherLostReason: z.string().max(500).nullish(),
  leadScore: z.number().int().min(0).max(100).nullish(),
  whatsappSubscriptionStatus: z.string().max(64).nullish(),
  smsSubscriptionStatus: z.string().max(64).nullish(),
  emailSubscriptionStatus: z.string().max(64).nullish(),
  emailConfirmed: z.boolean().optional(),
  faxNumber: z.string().max(32).nullish(),
  /** `null` clears the date; a minor flag set from it stays until a person clears it or the sweep reads the date again. */
  dateOfBirth: birthDateSchema.nullish(),
  source: z.string().trim().max(128).nullish(),
  /** The contact's own IANA time zone (BL-193). `null` clears it (the contact is then read on its number's country, then the workspace). */
  timezone: contactTimezoneSchema.nullish(),
  /** Marketing opt-out. Turning it on stamps `unsubscribedAt`; turning it off clears it. */
  isUnsubscribed: z.boolean().optional(),
  /** The proof that the person agreed to marketing; see `createContactSchema`. Needed when a status changes to `subscribed`. */
  consent: consentProofSchema.optional(),
  customFields: z.record(z.unknown()).optional(),
  /** Optimistic lock. Send the value you read; a mismatch returns 409. */
  rowVersion: z.number().int().positive(),
});
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

/** Page sizes: Reference offered 12/50/100/500/1000 and snapped anything else to 12; here any size up to 1000. */
export const CONTACT_LIST_MAX_LIMIT = 1000;

/** Columns the list can be sorted by, besides the default (newest first). `attr:<key>` sorts by a custom attribute. */
export const CONTACT_SORT_FIELDS = [
  'createdAt',
  'name',
  'phone',
  'email',
  'stage',
  'status',
  'language',
  'memo',
] as const;
export const contactSortSchema = z.union([
  z.enum(CONTACT_SORT_FIELDS),
  z.string().regex(/^attr:[a-z0-9_]{1,64}$/),
]);
export type ContactSort = z.infer<typeof contactSortSchema>;

export const listContactsQuerySchema = paginationQuerySchema
  .extend({
    ...contactFilterShape,
    /** What `order` applies to. Text columns sort case-insensitively with empty values last, ties broken by id. */
    sort: contactSortSchema.default('createdAt'),
    limit: z.coerce.number().int().min(1).max(CONTACT_LIST_MAX_LIMIT).default(50),
    /** `groups`, `tags` or `groups,tags`: adds the chips for each row. */
    expand: queryList(z.enum(['groups', 'tags'])).optional(),
    /** Adds `meta.total`, the count of every contact matching the filter ("Showing 1-50 of N"). */
    includeTotal: queryBoolean().default(false),
    /** A single tag, the way Reference's chip link sends it; merged into `tagIds`. */
    tagId: z.string().uuid().optional(),
  })
  .refine((v) => !(v.groupId && v.noGroup), {
    message: 'groupId and noGroup cannot be combined',
    path: ['noGroup'],
  })
  .describe(
    'Free-text search over name/email/phone digits, plus group, tag, source and consent filters',
  );
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

/** The page envelope, plus `meta.total` when the request asked for `includeTotal`. */
export type ContactListResponse = {
  data: ContactResponse[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
  /** `approximate`: the total of a segment's contacts could not be counted in 3 seconds and is the last known value or an estimate. */
  meta?: { total: number; approximate?: boolean };
  /** Only when the request filtered by `segmentId`: the segment's conditions that match nothing because something they point at was deleted. */
  segment?: { id: string; invalidConditions: InvalidCondition[] };
};

/** Lightweight rows for pickers/typeaheads — never the full record. */
export const contactSelectItemSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type ContactSelectItem = z.infer<typeof contactSelectItemSchema>;

export const contactSelectQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ContactSelectQuery = z.infer<typeof contactSelectQuerySchema>;

/**
 * The stage and status values contacts of the caller's scope actually hold, for the filter dropdowns. A workspace can
 * configure stages and statuses (status_options) and still have contacts on a value it does not list (the platform's
 * default stage `new`, a status that predates the configuration); a filter must be able to pick those too.
 */
export const contactFilterValuesSchema = z.object({
  lifecycleStages: z.array(z.string()),
  statuses: z.array(z.string()),
});
export type ContactFilterValues = z.infer<typeof contactFilterValuesSchema>;

/**
 * Bulk operations — Phase 11 exit criteria requires these be transactional
 * per row with partial-failure reporting, never all-or-nothing across the
 * whole batch (one bad id in a 200-row bulk-edit must not sink the other 199).
 */
export const bulkContactIdsSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(500),
});
export type BulkContactIdsInput = z.infer<typeof bulkContactIdsSchema>;

/** Same writable surface as UpdateContact, minus rowVersion — bulk-edit is last-write-wins per row. */
export const bulkUpdateContactsSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(500),
  values: z.object({
    ownerId: uuidSchema.nullish(),
    lifecycleStage: z.string().min(1).nullish(),
    /** Needed when `lifecycleStage` is a lost stage (the same reason is recorded on every contact moved). */
    lostReason: z.string().max(255).nullish(),
    otherLostReason: z.string().max(500).nullish(),
    status: z.string().max(64).nullish(),
    /** The IANA time zone to set on every contact (BL-193); `null` clears it. Recorded as set by staff. */
    timezone: contactTimezoneSchema.nullish(),
    /**
     * Custom properties to set on every contact, by property key. Each key must be an active, editable custom
     * property of the workspace (422 CON_PROPERTY_NOT_EDITABLE otherwise) and each value must fit the property's type
     * (422 VALIDATION_FAILED, nothing written). `null` (or a blank text / empty list) clears that key on every
     * contact; keys not named are left alone.
     */
    customFields: z.record(z.unknown()).optional(),
  }),
});
export type BulkUpdateContactsInput = z.infer<typeof bulkUpdateContactsSchema>;

export const bulkResultSchema = z.object({
  succeeded: z.array(uuidSchema),
  failed: z.array(z.object({ id: uuidSchema, code: z.string(), message: z.string() })),
});
export type BulkResult = z.infer<typeof bulkResultSchema>;

export const setContactAssigneeSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(500),
  ownerId: uuidSchema.nullable(),
});
export type SetContactAssigneeInput = z.infer<typeof setContactAssigneeSchema>;

/** A candidate owner for `ownerId` — the org's active staff users. */
export const assigneeResponseSchema = z.object({
  id: uuidSchema,
  fullName: z.string(),
  email: z.string(),
  /**
   * Whether the caller's record scope lets them hand a contact to this person (`all`: anyone; `team`: themselves and
   * teammates; `own`: themselves). The owner picker offers only these; the server enforces it again on every write.
   */
  canAssign: z.boolean(),
});
export type AssigneeResponse = z.infer<typeof assigneeResponseSchema>;

/**
 * Field history — one entry per changed field, flattened out of the
 * existing audit_log rather than a dedicated table: every contact write
 * already records a field-level delta there (see AuditService.diff), so
 * "what changed and when" is a read over data that already exists.
 */
export const fieldHistoryEntrySchema = z.object({
  fieldKey: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  actorType: z.string(),
  changedByUserId: uuidSchema.nullable(),
  changedAt: z.string().datetime(),
});
export type FieldHistoryEntry = z.infer<typeof fieldHistoryEntrySchema>;

export const listFieldHistoryQuerySchema = paginationQuerySchema;
export type ListFieldHistoryQuery = z.infer<typeof listFieldHistoryQuerySchema>;
