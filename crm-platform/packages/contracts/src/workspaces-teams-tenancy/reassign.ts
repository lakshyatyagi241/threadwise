import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { leaveDaySchema } from './leave';

/**
 * Reassign on demand, with an opt-in restore (BL-112 phase 2). A manager moves the contacts and open deals of a person who is away to
 * somebody else as one batch; the batch remembers what it moved, can be undone for `OWNER_REASSIGN_UNDO_DAYS`, and can bring the work
 * back on the day the person returns. A restore returns ONLY the rows nobody has touched since: the owner of each row carries the batch
 * that placed it there, and any other change of owner clears that mark (a database trigger, so no code path can forget).
 */
export const OWNER_REASSIGN_UNDO_DAYS = 14;
/** Rows of each kind one run moves; a bigger book is moved by running it again (`remaining` says how much is left). */
export const OWNER_REASSIGN_RUN_MAX = 50_000;

export const ownerReassignTargetSchema = z.discriminatedUnion('kind', [
  /** One person. */
  z.object({ kind: z.literal('user'), userId: uuidSchema }),
  /** The delegate the person named (refused when there is none, or they are away themselves). */
  z.object({ kind: z.literal('delegate') }),
  /** Round robin over the team's members who are active, present and not the person leaving. */
  z.object({ kind: z.literal('team'), teamId: uuidSchema }),
]);
export type OwnerReassignTarget = z.infer<typeof ownerReassignTargetSchema>;

export const ownerReassignPreviewSchema = z.object({ fromUserId: uuidSchema });
export type OwnerReassignPreviewInput = z.infer<typeof ownerReassignPreviewSchema>;

export const ownerReassignPreviewResponseSchema = z.object({
  contacts: z.number().int().nonnegative(),
  openDeals: z.number().int().nonnegative(),
  /** The most one run moves of each kind. */
  runMax: z.number().int(),
});
export type OwnerReassignPreview = z.infer<typeof ownerReassignPreviewResponseSchema>;

export const createOwnerReassignSchema = z.object({
  fromUserId: uuidSchema,
  target: ownerReassignTargetSchema,
  includeDeals: z.boolean().default(true),
  /** Opt in to bringing the work back: the day the person returns (the sweep restores that day, workspace calendar). Must be after today. */
  restoreOn: leaveDaySchema.nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});
export type CreateOwnerReassignInput = z.infer<typeof createOwnerReassignSchema>;

export const OWNER_REASSIGN_STATUSES = ['applied', 'restored', 'restore_blocked'] as const;

export const ownerReassignBatchSchema = z.object({
  id: uuidSchema,
  fromUser: z.object({ id: uuidSchema, name: z.string() }),
  target: z.object({
    kind: z.enum(['user', 'delegate', 'team']),
    userId: uuidSchema.nullable(),
    userName: z.string().nullable(),
    teamId: uuidSchema.nullable(),
    teamName: z.string().nullable(),
  }),
  includeDeals: z.boolean(),
  reason: z.string().nullable(),
  restoreOn: leaveDaySchema.nullable(),
  status: z.enum(OWNER_REASSIGN_STATUSES),
  movedContacts: z.number().int(),
  movedDeals: z.number().int(),
  restoredContacts: z.number().int(),
  restoredDeals: z.number().int(),
  /** Left where they are at restore: somebody else changed them since, or they were deleted. */
  notRestored: z.number().int(),
  /** Still waiting to be moved because the run hit its limit: run it again. */
  remaining: z.number().int(),
  undoUntil: z.string().datetime(),
  /** Whether the person asking may bring the work back now (status applied, inside the undo window or an opted-in return). */
  canRestore: z.boolean(),
  createdAt: z.string().datetime(),
  restoredAt: z.string().datetime().nullable(),
});
export type OwnerReassignBatch = z.infer<typeof ownerReassignBatchSchema>;

export const ownerReassignListQuerySchema = z.object({
  fromUserId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type OwnerReassignListQuery = z.infer<typeof ownerReassignListQuerySchema>;

export const OWNER_REASSIGN_APPLIED = 'owner.reassign.applied';
export const OWNER_REASSIGN_RESTORED = 'owner.reassign.restored';
