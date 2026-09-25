import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema } from '../common/ids';
import { lifecycleStageSchema, recordLifecycleSchema } from '../common/enums';
import { paginationQuerySchema } from '../common/pagination';

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
  email: z.string().nullable(),
  phone: z.string().nullable(),
  companyId: uuidSchema.nullable(),
  ownerId: uuidSchema.nullable(),
  lifecycleState: recordLifecycleSchema,
  lifecycleStage: z.string().nullable(),
  status: z.string().nullable(),
  customFields: z.record(z.unknown()),
  isArchived: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContactResponse = z.infer<typeof contactResponseSchema>;

export const createContactSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    companyId: uuidSchema.optional(),
    ownerId: uuidSchema.optional(),
    lifecycleStage: lifecycleStageSchema.or(z.string().min(1)).optional(),
    status: z.string().max(64).optional(),
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
  email: emailSchema.nullish(),
  phone: phoneSchema.nullish(),
  companyId: uuidSchema.nullish(),
  ownerId: uuidSchema.nullish(),
  lifecycleStage: z.string().min(1).nullish(),
  status: z.string().max(64).nullish(),
  customFields: z.record(z.unknown()).optional(),
  /** Optimistic lock. Send the value you read; a mismatch returns 409. */
  rowVersion: z.number().int().positive(),
});
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const listContactsQuerySchema = paginationQuerySchema.extend({
  q: z.string().min(1).max(200).optional().describe('Free-text search over name/email/phone'),
  ownerId: uuidSchema.optional(),
  lifecycleStage: z.string().optional(),
  includeArchived: z.coerce.boolean().default(false),
});
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

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
