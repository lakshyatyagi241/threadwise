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
