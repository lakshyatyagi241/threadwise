import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/**
 * Saved contact list views ("All Contacts", "My Contacts", custom...).
 *
 * `filter` is an AND/OR condition tree over contacts columns and Tier-2
 * fields — like `customFields` on Contact, its shape depends on the org's
 * field definitions, so it stays a validated-at-runtime record here rather
 * than a typed union of every possible condition.
 */
/** Who a view is visible to: its creator only, the whole workspace, or the chosen people. */
export const VIEW_SHARE_MODES = ['me', 'everyone', 'selected'] as const;
export const viewShareModeSchema = z.enum(VIEW_SHARE_MODES);
export type ViewShareMode = z.infer<typeof viewShareModeSchema>;

/** What the people a view is shared with may do. The creator can always do both, and alone changes the sharing or deletes it. */
export const VIEW_ACCESS_TYPES = ['can_view', 'can_edit'] as const;
export const viewAccessTypeSchema = z.enum(VIEW_ACCESS_TYPES);
export type ViewAccessType = z.infer<typeof viewAccessTypeSchema>;

export const MAX_VIEW_SHARED_USERS = 200;

export const contactViewResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  filter: z.record(z.unknown()),
  position: z.number().int(),
  /** Visible beyond the creator (any share mode but 'me'). */
  isShared: z.boolean(),
  shareMode: viewShareModeSchema,
  accessType: viewAccessTypeSchema,
  /** The people a 'selected' view is shared with (user ids); empty for the other modes. */
  sharedWith: z.array(uuidSchema),
  /** The caller may change this view's name and filter (the creator, or anyone it is shared with as `can_edit`). */
  canEdit: z.boolean(),
  /** The caller may change who it is shared with, and delete it (the creator). */
  canManage: z.boolean(),
  createdBy: uuidSchema.nullable(),
  /** Whether the calling user has favorited this view. */
  isFavorite: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContactViewResponse = z.infer<typeof contactViewResponseSchema>;

/**
 * `shareMode` wins over the older `isShared` flag, which still works on its own (`true` = everyone). A 'selected' view needs at least one
 * person in `userIds`; the other modes ignore the list.
 */
const sharingShape = {
  shareMode: viewShareModeSchema.optional(),
  accessType: viewAccessTypeSchema.optional(),
  userIds: z.array(uuidSchema).max(MAX_VIEW_SHARED_USERS).optional(),
};
const selectedNeedsPeople = (v: { shareMode?: ViewShareMode; userIds?: string[] }) =>
  v.shareMode !== 'selected' || (v.userIds !== undefined && v.userIds.length > 0);
const SELECTED_NEEDS_PEOPLE = {
  message: 'Choose at least one person to share with',
  path: ['userIds'],
};

/** How long a saved view's name may be: short enough to read in the views bar, long enough to say what the view is. */
export const CONTACT_VIEW_NAME_MIN = 3;
export const CONTACT_VIEW_NAME_MAX = 50;
const viewName = z.string().trim().min(CONTACT_VIEW_NAME_MIN).max(CONTACT_VIEW_NAME_MAX);

export const createContactViewSchema = z
  .object({
    name: viewName,
    filter: z.record(z.unknown()).default({}),
    isShared: z.boolean().default(false),
    position: z.number().int().optional(),
    ...sharingShape,
  })
  .refine(selectedNeedsPeople, SELECTED_NEEDS_PEOPLE);
export type CreateContactViewInput = z.infer<typeof createContactViewSchema>;

export const updateContactViewSchema = z
  .object({
    name: viewName.optional(),
    filter: z.record(z.unknown()).optional(),
    isShared: z.boolean().optional(),
    ...sharingShape,
    rowVersion: z.number().int().positive(),
  })
  .refine(selectedNeedsPeople, SELECTED_NEEDS_PEOPLE);
export type UpdateContactViewInput = z.infer<typeof updateContactViewSchema>;

export const listContactViewsQuerySchema = paginationQuerySchema;
export type ListContactViewsQuery = z.infer<typeof listContactViewsQuerySchema>;

export const reorderContactViewsSchema = z.object({
  orderedIds: z.array(uuidSchema).min(1),
});
export type ReorderContactViewsInput = z.infer<typeof reorderContactViewsSchema>;
