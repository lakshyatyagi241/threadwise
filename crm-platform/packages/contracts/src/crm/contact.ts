import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema } from '../common/ids';
import { lifecycleStageSchema, recordLifecycleSchema } from '../common/enums';
import { paginationQuerySchema } from '../common/pagination';
import { contactFilterShape } from '../contacts-attributes-tags/contact-filter';
import { contactGroupRefSchema } from '../contacts-attributes-tags/contact-group';
import { queryBoolean, queryList } from '../contacts-attributes-tags/query-helpers';

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
  /** Values are org-configurable via status_options, not a fixed enum here. */
  whatsappSubscriptionStatus: z.string().nullable(),
  smsSubscriptionStatus: z.string().nullable(),
  emailSubscriptionStatus: z.string().nullable(),
  emailConfirmed: z.boolean(),
  faxNumber: z.string().nullable(),
  /** Bumped by note/activity/meeting writes — server-maintained. */
  lastActivityAt: z.string().datetime().nullable(),
  customFields: z.record(z.unknown()),
  /** Where the contact came from: the import's source knob, "import", an API client... */
  source: z.string().nullable(),
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
    ownerId: uuidSchema.optional(),
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
    /** Where the contact came from (TW-CON-015): a form, a campaign, "api". Free text. */
    source: z.string().trim().max(128).optional(),
    /** Marketing opt-out (TW-CON-017): broadcasts and campaigns skip an opted-out contact. */
    isUnsubscribed: z.boolean().optional(),
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
  source: z.string().trim().max(128).nullish(),
  /** Marketing opt-out. Turning it on stamps `unsubscribedAt`; turning it off clears it. */
  isUnsubscribed: z.boolean().optional(),
  customFields: z.record(z.unknown()).optional(),
  /** Optimistic lock. Send the value you read; a mismatch returns 409. */
  rowVersion: z.number().int().positive(),
});
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

/** Page sizes: Reference offered 12/50/100/500/1000 and snapped anything else to 12; here any size up to 1000. */
export const CONTACT_LIST_MAX_LIMIT = 1000;

export const listContactsQuerySchema = paginationQuerySchema
  .extend({
    ...contactFilterShape,
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
  meta?: { total: number };
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
