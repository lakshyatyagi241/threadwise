import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { fieldTypeSchema, moduleKeySchema } from '../common/enums';
import { paginationQuerySchema } from '../common/pagination';

/**
 * Field metadata — the Tier-2 custom-field registry behind Settings > Data
 * Management (Phase 8, docs/phase-plan.md). `moduleKey` is generic:
 * 'contacts' today, 'companies' reuses every schema here unchanged.
 */

// --- Field sections --------------------------------------------------------

export const fieldSectionResponseSchema = z.object({
  id: uuidSchema,
  moduleKey: moduleKeySchema,
  name: z.string(),
  position: z.number().int(),
  isActive: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FieldSectionResponse = z.infer<typeof fieldSectionResponseSchema>;

export const createFieldSectionSchema = z.object({
  moduleKey: moduleKeySchema,
  name: z.string().min(1).max(255),
  position: z.number().int().optional(),
});
export type CreateFieldSectionInput = z.infer<typeof createFieldSectionSchema>;

export const updateFieldSectionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateFieldSectionInput = z.infer<typeof updateFieldSectionSchema>;

export const listFieldSectionsQuerySchema = paginationQuerySchema.extend({
  moduleKey: moduleKeySchema,
});
export type ListFieldSectionsQuery = z.infer<typeof listFieldSectionsQuerySchema>;

export const reorderFieldSectionsSchema = z.object({
  moduleKey: moduleKeySchema,
  /** Section ids in the order they should render, top to bottom. */
  orderedIds: z.array(uuidSchema).min(1),
});
export type ReorderFieldSectionsInput = z.infer<typeof reorderFieldSectionsSchema>;

// --- Field options -----------------------------------------------------

export const fieldOptionResponseSchema = z.object({
  id: uuidSchema,
  fieldId: uuidSchema,
  value: z.string(),
  label: z.string(),
  position: z.number().int(),
  isHidden: z.boolean(),
  rowVersion: z.number().int(),
});
export type FieldOptionResponse = z.infer<typeof fieldOptionResponseSchema>;

export const createFieldOptionSchema = z.object({
  value: z.string().min(1).max(255),
  label: z.string().min(1).max(255),
  position: z.number().int().optional(),
});
export type CreateFieldOptionInput = z.infer<typeof createFieldOptionSchema>;

export const updateFieldOptionSchema = z.object({
  value: z.string().min(1).max(255).optional(),
  label: z.string().min(1).max(255).optional(),
  isHidden: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateFieldOptionInput = z.infer<typeof updateFieldOptionSchema>;

export const reorderFieldOptionsSchema = z.object({
  orderedIds: z.array(uuidSchema).min(1),
});
export type ReorderFieldOptionsInput = z.infer<typeof reorderFieldOptionsSchema>;

// --- Fields ----------------------------------------------------------------

/** select/multiselect/radio/lookup carry `options` inline — every other type omits it. */
export const fieldResponseSchema = z.object({
  id: uuidSchema,
  moduleKey: moduleKeySchema,
  sectionId: uuidSchema.nullable(),
  key: z.string(),
  label: z.string(),
  fieldType: fieldTypeSchema,
  isRequired: z.boolean(),
  isHidden: z.boolean(),
  isReadOnly: z.boolean(),
  isMasked: z.boolean(),
  isUnique: z.boolean(),
  isQuickCreate: z.boolean(),
  isGlobalSearch: z.boolean(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  position: z.number().int(),
  /** Type-specific: currency->{code}, rating->{max}, formula->{expression}, ... */
  config: z.record(z.unknown()),
  replacesFieldId: uuidSchema.nullable(),
  options: z.array(fieldOptionResponseSchema).optional(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FieldResponse = z.infer<typeof fieldResponseSchema>;

export const createFieldSchema = z.object({
  moduleKey: moduleKeySchema,
  sectionId: uuidSchema,
  /** Storage key inside the target module's `data` jsonb. Immutable once created. */
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, 'key must be snake_case, starting with a letter'),
  label: z.string().min(1).max(255),
  fieldType: fieldTypeSchema,
  isRequired: z.boolean().default(false),
  isHidden: z.boolean().default(false),
  isReadOnly: z.boolean().default(false),
  isMasked: z.boolean().default(false),
  isUnique: z.boolean().default(false),
  isQuickCreate: z.boolean().default(false),
  isGlobalSearch: z.boolean().default(false),
  config: z.record(z.unknown()).default({}),
  position: z.number().int().optional(),
  /** select/multiselect/radio only — lookup/formula configure via `config` instead. */
  options: z.array(createFieldOptionSchema).optional(),
});
export type CreateFieldInput = z.infer<typeof createFieldSchema>;

/**
 * Every writable flag except `key` and `fieldType` — changing either of
 * those is a type-change, handled by `replaces_field_id` versioning
 * (create the new field, point it at the old one), never an in-place PATCH.
 */
export const updateFieldSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  sectionId: uuidSchema.optional(),
  isRequired: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  isReadOnly: z.boolean().optional(),
  isMasked: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  isQuickCreate: z.boolean().optional(),
  isGlobalSearch: z.boolean().optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateFieldInput = z.infer<typeof updateFieldSchema>;

export const listFieldsQuerySchema = paginationQuerySchema.extend({
  moduleKey: moduleKeySchema,
  sectionId: uuidSchema.optional(),
  includeInactive: z.coerce.boolean().default(false),
});
export type ListFieldsQuery = z.infer<typeof listFieldsQuerySchema>;

export const reorderFieldsSchema = z.object({
  moduleKey: moduleKeySchema,
  sectionId: uuidSchema,
  orderedIds: z.array(uuidSchema).min(1),
});
export type ReorderFieldsInput = z.infer<typeof reorderFieldsSchema>;

// --- Field dependencies (field-level: shows/hides the dependent field) -----

export const fieldDependencyResponseSchema = z.object({
  id: uuidSchema,
  fieldId: uuidSchema,
  dependsOnFieldId: uuidSchema,
  dependsOnOptionId: uuidSchema.nullable(),
  dependsOnValue: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type FieldDependencyResponse = z.infer<typeof fieldDependencyResponseSchema>;

export const createFieldDependencySchema = z
  .object({
    fieldId: uuidSchema,
    dependsOnFieldId: uuidSchema,
    dependsOnOptionId: uuidSchema.optional(),
    dependsOnValue: z.string().optional(),
  })
  .refine((v) => v.fieldId !== v.dependsOnFieldId, {
    message: 'a field cannot depend on itself',
    path: ['dependsOnFieldId'],
  })
  .refine((v) => !(v.dependsOnOptionId && v.dependsOnValue), {
    message: 'set at most one of dependsOnOptionId, dependsOnValue',
    path: ['dependsOnOptionId'],
  });
export type CreateFieldDependencyInput = z.infer<typeof createFieldDependencySchema>;

// --- Field option dependencies (option-level, many:many) -------------------

export const fieldOptionDependencyResponseSchema = z.object({
  id: uuidSchema,
  parentOptionId: uuidSchema,
  childOptionId: uuidSchema,
  createdAt: z.string().datetime(),
});
export type FieldOptionDependencyResponse = z.infer<typeof fieldOptionDependencyResponseSchema>;

export const createFieldOptionDependencySchema = z
  .object({
    parentOptionId: uuidSchema,
    childOptionId: uuidSchema,
  })
  .refine((v) => v.parentOptionId !== v.childOptionId, {
    message: 'an option cannot depend on itself',
    path: ['childOptionId'],
  });
export type CreateFieldOptionDependencyInput = z.infer<typeof createFieldOptionDependencySchema>;

// --- Status options (lifecycle_stage, deal_status, subscription statuses) --

export const statusOptionResponseSchema = z.object({
  id: uuidSchema,
  moduleKey: moduleKeySchema,
  optionGroup: z.string(),
  value: z.string(),
  label: z.string(),
  color: z.string().nullable(),
  position: z.number().int(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  /**
   * Lifecycle stages only: a contact entering a won stage gets `wonAt`, one entering a lost stage gets `lostAt` and must
   * carry a lost reason. Never both; false on every other group.
   */
  isWon: z.boolean(),
  isLost: z.boolean(),
  /**
   * Contact statuses only: the lifecycle stage option this status belongs to, or null when it is valid in every stage.
   * `isDefault` on a scoped status means "the status a contact gets when it enters that stage without a valid one".
   */
  stageOptionId: uuidSchema.nullable(),
  rowVersion: z.number().int(),
});
export type StatusOptionResponse = z.infer<typeof statusOptionResponseSchema>;

export const createStatusOptionSchema = z.object({
  moduleKey: moduleKeySchema,
  optionGroup: z.string().min(1).max(100),
  value: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, 'value must be snake_case, starting with a letter'),
  label: z.string().min(1).max(255),
  color: z.string().max(32).optional(),
  position: z.number().int().optional(),
  isDefault: z.boolean().default(false),
  /** Only on the `lifecycle_stage` group of `contacts` (422 STATUS_OPTION_FLAG_INVALID elsewhere, or when both are set). */
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
  /**
   * Only on the `status` / `contact_status` groups of `contacts`: scope the status to one lifecycle stage option of the
   * workspace (null or absent = every stage). 422 STATUS_OPTION_STAGE_INVALID when it is not a lifecycle stage or the group
   * cannot be scoped.
   */
  stageOptionId: uuidSchema.nullish(),
});
export type CreateStatusOptionInput = z.infer<typeof createStatusOptionSchema>;

export const updateStatusOptionSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  color: z.string().max(32).nullish(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  /** Setting one to true clears the other unless the request also names it; both true is 422 STATUS_OPTION_FLAG_INVALID. */
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  /** Absent keeps the scope, null makes the status valid in every stage. Scope changes are not applied to contacts already holding it. */
  stageOptionId: uuidSchema.nullish(),
  rowVersion: z.number().int().positive(),
});
export type UpdateStatusOptionInput = z.infer<typeof updateStatusOptionSchema>;

export const listStatusOptionsQuerySchema = paginationQuerySchema.extend({
  moduleKey: moduleKeySchema,
  optionGroup: z.string().optional(),
});
export type ListStatusOptionsQuery = z.infer<typeof listStatusOptionsQuerySchema>;

export const reorderStatusOptionsSchema = z.object({
  moduleKey: moduleKeySchema,
  optionGroup: z.string().min(1),
  orderedIds: z.array(uuidSchema).min(1),
});
export type ReorderStatusOptionsInput = z.infer<typeof reorderStatusOptionsSchema>;

// --- Usage counts and delete-with-reassign (Contact stages / Contact properties screens) ---

/** How many contacts hold each value of one option group (`lifecycle_stage`, `status`, `lost_reason`). */
export const statusOptionUsageQuerySchema = z.object({
  moduleKey: moduleKeySchema,
  optionGroup: z.string().min(1).max(100),
});
export type StatusOptionUsageQuery = z.infer<typeof statusOptionUsageQuerySchema>;

export const statusOptionUsageResponseSchema = z.object({
  data: z.array(z.object({ id: uuidSchema, value: z.string(), count: z.number().int() })),
});
export type StatusOptionUsageResponse = z.infer<typeof statusOptionUsageResponseSchema>;

/**
 * Deleting an option that contacts still hold needs somewhere to move them: `moveTo` is the id of another option of
 * the same group. Without it the call is 409 `STATUS_OPTION_IN_USE` (`errors:[{path:"contacts", message:"<count>"}]`).
 */
export const deleteStatusOptionQuerySchema = z.object({
  moveTo: uuidSchema.optional(),
});
export type DeleteStatusOptionQuery = z.infer<typeof deleteStatusOptionQuerySchema>;

/** How many contacts hold a non-empty value for each custom field key of a module. */
export const fieldUsageQuerySchema = z.object({ moduleKey: moduleKeySchema });
export type FieldUsageQuery = z.infer<typeof fieldUsageQuerySchema>;

export const fieldUsageResponseSchema = z.object({
  data: z.array(z.object({ id: uuidSchema, key: z.string(), count: z.number().int() })),
});
export type FieldUsageResponse = z.infer<typeof fieldUsageResponseSchema>;
