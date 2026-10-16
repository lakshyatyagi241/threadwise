import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';
import { contactResponseSchema } from '../crm/contact';
import { hexColorSchema } from '../contacts-attributes-tags/contact-group';
import { queryBoolean } from '../contacts-attributes-tags/query-helpers';
import { contactFilterShape } from '../contacts-attributes-tags/contact-filter';
import {
  SEGMENT_MAX_CONDITIONS,
  invalidConditionSchema,
  segmentRulesSchema,
  type SegmentCondition,
  type SegmentNode,
  type SegmentRules,
} from './rules';

/**
 * Segments (product extension; Reference has none). A GROUP is a static list a person fills by hand. A
 * SEGMENT is a saved rule that fills itself: contacts enter and leave as their data changes.
 */
export const SEGMENT_NAME_MAX = 191;
export const SEGMENT_DESCRIPTION_MAX = 1000;
/** Contacts shown by a rule preview. */
export const SEGMENT_PREVIEW_SAMPLE = 10;
/** A segment's count is recomputed when it is older than this (milliseconds). */
export const SEGMENT_COUNT_TTL_MS = 5 * 60 * 1000;
/** More members than this are added to a group by a background job, in chunks of this size. */
export const SEGMENT_INLINE_ACTION_MAX = 1000;

/** People and teams one segment can be shared with. */
export const SEGMENT_SHARE_MAX = 200;

/**
 * `private`: the owner and people who can edit every segment. `shared`: everyone who can view segments.
 * `specific` (a change beyond Reference, by request): only the people and teams in `sharedWith`, plus the owner and people
 * who can edit every segment. Sharing is view-and-use only; editing and deleting stay with the owner / edit-all.
 */
export const segmentVisibilitySchema = z.enum(['private', 'shared', 'specific']);
export type SegmentVisibility = z.infer<typeof segmentVisibilitySchema>;

/** Who a `specific` segment is shared with, as ids. The owner never needs to be in it. */
export const segmentSharedWithInputSchema = z
  .object({
    userIds: z.array(uuidSchema).max(SEGMENT_SHARE_MAX).default([]),
    teamIds: z.array(uuidSchema).max(SEGMENT_SHARE_MAX).default([]),
  })
  .strict()
  .refine((v) => v.userIds.length + v.teamIds.length <= SEGMENT_SHARE_MAX, {
    message: `share with at most ${SEGMENT_SHARE_MAX} people and teams`,
    path: ['userIds'],
  });
export type SegmentSharedWithInput = z.infer<typeof segmentSharedWithInputSchema>;

/** What a picker and a badge need about a person the segment is shared with. `email` only for callers who can edit. */
export const segmentSharedUserSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  email: z.string().nullable(),
});
export const segmentSharedTeamSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  memberCount: z.number().int(),
});
export const segmentSharedWithSchema = z.object({
  users: z.array(segmentSharedUserSchema),
  teams: z.array(segmentSharedTeamSchema),
});
export type SegmentSharedWith = z.infer<typeof segmentSharedWithSchema>;

export const segmentResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  color: z.string().nullable(),
  /** `private`: the owner and admins only. `shared`: every member who can read segments. `specific`: see `sharedWith`. */
  visibility: segmentVisibilitySchema,
  /** Who it is shared with; empty unless `visibility` is `specific`. */
  sharedWith: segmentSharedWithSchema,
  ownerId: uuidSchema.nullable(),
  ownerName: z.string().nullable(),
  rules: segmentRulesSchema,
  rulesVersion: z.number().int(),
  /** Members right now, or the last count we have; null when none was computed yet. */
  memberCount: z.number().int().nullable(),
  /** true: the database could not count in time; `memberCount` is the last known or an estimate. */
  countApproximate: z.boolean(),
  /** When `memberCount` was computed. */
  memberCountAt: z.string().datetime().nullable(),
  /** Conditions that point at something that was deleted: they match nothing until fixed. */
  invalidConditions: z.array(invalidConditionSchema),
  /** Whether the caller may edit or delete it. */
  canEdit: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SegmentResponse = z.infer<typeof segmentResponseSchema>;

const nameSchema = z.string().trim().min(1).max(SEGMENT_NAME_MAX);
const descriptionSchema = z.string().trim().max(SEGMENT_DESCRIPTION_MAX);

export const createSegmentSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.nullish(),
    color: hexColorSchema.nullish(),
    visibility: segmentVisibilitySchema.default('private'),
    /** Required, and not empty, when `visibility` is `specific`. */
    sharedWith: segmentSharedWithInputSchema.optional(),
    rules: segmentRulesSchema,
  })
  .strict();
export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;

/** Absent keeps, null clears (description, colour). */
export const updateSegmentSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.nullish(),
    color: hexColorSchema.nullish(),
    visibility: segmentVisibilitySchema.optional(),
    /** Absent keeps the people as they are; sent, it replaces the whole list (needs `specific`). */
    sharedWith: segmentSharedWithInputSchema.optional(),
    rules: segmentRulesSchema.optional(),
    rowVersion: z.number().int().positive(),
  })
  .strict();
export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema>;

export const listSegmentsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  visibility: segmentVisibilitySchema.optional(),
  /** Only the caller's own segments. */
  mine: queryBoolean().optional(),
});
export type ListSegmentsQuery = z.infer<typeof listSegmentsQuerySchema>;

/** Rules in, count and a first look out: nothing is saved. */
export const previewSegmentSchema = z.object({ rules: segmentRulesSchema }).strict();
export type PreviewSegmentInput = z.infer<typeof previewSegmentSchema>;

export const segmentPreviewResponseSchema = z.object({
  count: z.number().int(),
  /** true: counting timed out; `count` is the planner's estimate. */
  countApproximate: z.boolean(),
  sample: z.array(contactResponseSchema).max(SEGMENT_PREVIEW_SAMPLE),
  invalidConditions: z.array(invalidConditionSchema),
});
export type SegmentPreviewResponse = z.infer<typeof segmentPreviewResponseSchema>;

export const segmentCountResponseSchema = z.object({
  memberCount: z.number().int(),
  countApproximate: z.boolean(),
  memberCountAt: z.string().datetime(),
});
export type SegmentCountResponse = z.infer<typeof segmentCountResponseSchema>;

// --- actions ----------------------------------------------------------------------------------

/** `bom`: UTF-8 byte-order mark so spreadsheets decode non-ASCII names. */
export const exportSegmentSchema = z.object({ bom: queryBoolean().default(true) }).strict();
export type ExportSegmentInput = z.infer<typeof exportSegmentSchema>;

/** Tag every current member (a snapshot: contacts that join later are not tagged). By id or by name. */
export const tagSegmentSchema = z
  .object({
    tagId: uuidSchema.optional(),
    name: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.tagId) !== Boolean(v.name), {
    message: 'send either tagId or name',
    path: ['tagId'],
  });
export type TagSegmentInput = z.infer<typeof tagSegmentSchema>;

/** Copy the current members into a group (a snapshot). */
export const addSegmentToGroupSchema = z.object({ groupId: uuidSchema }).strict();
export type AddSegmentToGroupInput = z.infer<typeof addSegmentToGroupSchema>;

export const segmentActionResponseSchema = z.object({
  /** Members the action applied to. */
  matched: z.number().int(),
  /** Changed so far: 0 when `queued`. */
  changed: z.number().int(),
  /** true: more than SEGMENT_INLINE_ACTION_MAX members, so a background job does it in chunks. */
  queued: z.boolean(),
});
export type SegmentActionResponse = z.infer<typeof segmentActionResponseSchema>;

// --- from the contacts filter ---------------------------------------------------------------

/** The contacts list filter minus the pieces a segment cannot hold (`segmentId` itself, archived rows). */
const segmentFilterSchema = z
  .object(contactFilterShape)
  .omit({ segmentId: true, includeArchived: true })
  .strict();

export const segmentFromFiltersSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.nullish(),
    color: hexColorSchema.nullish(),
    visibility: segmentVisibilitySchema.default('private'),
    sharedWith: segmentSharedWithInputSchema.optional(),
    filter: segmentFilterSchema,
  })
  .strict();
export type SegmentFromFiltersInput = z.infer<typeof segmentFromFiltersSchema>;

export type SegmentFilterInput = SegmentFromFiltersInput['filter'];

/**
 * The contacts list filter as segment rules (AND of its parts), so "save this filter as a segment"
 * means exactly what the list was showing. Returns null when the filter has no conditions.
 * Archived contacts are never in a segment, as they are not in the default list.
 */
export function contactFilterToRules(filter: SegmentFilterInput): SegmentRules | null {
  const c: SegmentNode[] = [];
  const add = (
    field: string,
    operator: SegmentCondition['operator'],
    value?: SegmentCondition['value'],
  ) => c.push({ type: 'condition', field, operator, ...(value === undefined ? {} : { value }) });

  if (filter.q) add('search', 'matches', filter.q);
  if (filter.ownerId) add('owner', 'equals', filter.ownerId);
  const ownerIds = filter.ownerIds ?? [];
  if (ownerIds.length > 0 && filter.unassigned) {
    // "These people or nobody" is an OR inside the AND of the other parts.
    c.push({
      type: 'group',
      combinator: 'or',
      children: [
        { type: 'condition', field: 'owner', operator: 'in', value: ownerIds },
        { type: 'condition', field: 'owner', operator: 'is_empty' },
      ],
    });
  } else if (ownerIds.length > 0) add('owner', 'in', ownerIds);
  else if (filter.unassigned) add('owner', 'is_empty');
  if (filter.lifecycleStage) add('lifecycleStage', 'equals', filter.lifecycleStage);
  if (filter.status) add('status', 'equals', filter.status);
  if (filter.source) add('source', 'equals', filter.source);
  if (filter.groupId) add('groups', 'has_any', [filter.groupId]);
  if (filter.noGroup) add('groups', 'is_empty');
  if (filter.tagIds && filter.tagIds.length > 0) {
    add('tags', filter.tagMode === 'all' ? 'has_all' : 'has_any', filter.tagIds);
  }
  if (filter.imported !== undefined) add('imported', filter.imported ? 'is_true' : 'is_false');
  if (filter.unsubscribed !== undefined) {
    add('unsubscribed', filter.unsubscribed ? 'is_true' : 'is_false');
  }
  if (filter.minor !== undefined) add('minor', filter.minor ? 'is_true' : 'is_false');
  for (const [field, from, to] of [
    ['createdAt', filter.createdFrom, filter.createdTo],
    ['updatedAt', filter.updatedFrom, filter.updatedTo],
    ['lastActivityAt', filter.lastActivityFrom, filter.lastActivityTo],
  ] as const) {
    if (from && to) add(field, 'between', { from, to });
    else if (from) add(field, 'on_or_after', from);
    else if (to) add(field, 'on_or_before', to);
  }

  if (c.length === 0 || c.length > SEGMENT_MAX_CONDITIONS) return null;
  return { type: 'group', combinator: 'and', children: c } as SegmentRules;
}

// --- the contacts of a segment -----------------------------------------------------------------

export const segmentUsageKindSchema = z.enum(['tag', 'group', 'stage', 'status', 'field', 'user']);
export type SegmentUsageKind = z.infer<typeof segmentUsageKindSchema>;

/** Which segments use a tag, group, stage, status, custom property or user: the warning before deleting it. */
export const segmentUsageQuerySchema = z.object({
  kind: segmentUsageKindSchema,
  /** The tag / group / user uuid, or the stage / status value, or the property key. */
  ref: z.string().min(1).max(255),
});
export type SegmentUsageQuery = z.infer<typeof segmentUsageQuerySchema>;

export const segmentUsageResponseSchema = z.object({
  data: z.array(z.object({ id: uuidSchema, name: z.string() })),
});
export type SegmentUsageResponse = z.infer<typeof segmentUsageResponseSchema>;
