import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { parseDateValue } from '../common/dates';

/**
 * Member leave and delegate (BL-112, docs/specs/contact-owner-leave-and-delegation.md).
 *
 * A member can be "on leave" for a range of calendar days in the WORKSPACE's time zone (`organizations.settings.timezone`, UTC when the
 * workspace has none), and can name one delegate. Automatic assignment never picks someone who is on leave; when it would, it hands
 * the work to the delegate (when that person is available), else to the team pool, else leaves it unassigned and tells the leads.
 *
 * "On leave now" is always derived from the dates (`startsOn <= today <= endsOn`), never from `status` alone: `status` follows with a
 * short delay (the worker sweep flips it and announces it), the answer to "may I pick this person" does not.
 */

/** A calendar day, `YYYY-MM-DD`, that exists (no 2026-02-31). */
export const leaveDaySchema = z
  .string()
  .refine((v) => parseDateValue(v)?.kind === 'day', { message: 'Use a calendar day, YYYY-MM-DD' });

export const MEMBER_LEAVE_STATUSES = ['scheduled', 'active', 'ended', 'cancelled'] as const;
export const memberLeaveStatusSchema = z.enum(MEMBER_LEAVE_STATUSES);
export type MemberLeaveStatus = z.infer<typeof memberLeaveStatusSchema>;

export const MEMBER_LEAVE_REASON_MAX = 500;

export const memberLeaveSchema = z.object({
  id: uuidSchema,
  memberId: uuidSchema,
  memberName: z.string(),
  startsOn: leaveDaySchema,
  /** Last day away; the person is back the day after. Null = open-ended, until somebody ends it. */
  endsOn: leaveDaySchema.nullable(),
  /** Only for people who manage leave of others, and for the person themselves; null for colleagues. */
  reason: z.string().nullable(),
  status: memberLeaveStatusSchema,
  /** True when today (workspace calendar) lies inside the range and the leave still counts. */
  onLeaveNow: z.boolean(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type MemberLeave = z.infer<typeof memberLeaveSchema>;

/** `POST /workspace/members/:id/leaves`. A start in the past is refused: leave is announced, not recorded afterwards. */
export const createMemberLeaveSchema = z
  .object({
    startsOn: leaveDaySchema,
    endsOn: leaveDaySchema.nullable().optional(),
    reason: z.string().trim().max(MEMBER_LEAVE_REASON_MAX).nullable().optional(),
  })
  .refine((v) => v.endsOn == null || v.endsOn >= v.startsOn, {
    message: 'The last day cannot be before the first day',
    path: ['endsOn'],
  });
export type CreateMemberLeaveInput = z.infer<typeof createMemberLeaveSchema>;

/** `PATCH /workspace/leaves/:id`. An active leave keeps its start; its end and reason can change. */
export const updateMemberLeaveSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    startsOn: leaveDaySchema.optional(),
    endsOn: leaveDaySchema.nullable().optional(),
    reason: z.string().trim().max(MEMBER_LEAVE_REASON_MAX).nullable().optional(),
  })
  .refine((v) => v.startsOn !== undefined || v.endsOn !== undefined || v.reason !== undefined, {
    message: 'Nothing to change',
  });
export type UpdateMemberLeaveInput = z.infer<typeof updateMemberLeaveSchema>;

export const listMemberLeavesQuerySchema = z.object({
  /** `open` (default): ongoing and coming up. `all`: with the ended and cancelled ones. */
  view: z.enum(['open', 'all']).default('open'),
  memberId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListMemberLeavesQuery = z.infer<typeof listMemberLeavesQuerySchema>;

export const memberLeaveListSchema = z.object({
  data: z.array(memberLeaveSchema),
  /** The workspace calendar's today: the client compares dates with this, not with the browser's clock. */
  today: leaveDaySchema,
  timezone: z.string(),
});
export type MemberLeaveList = z.infer<typeof memberLeaveListSchema>;

export const memberDelegateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /** The delegate is away themselves right now: automatic assignment will skip them and use the team pool. */
  onLeaveNow: z.boolean(),
});
export type MemberDelegate = z.infer<typeof memberDelegateSchema>;

/** `PUT /workspace/members/:id/delegate`: `null` removes the delegate. */
export const setMemberDelegateSchema = z.object({
  delegateId: uuidSchema.nullable(),
});
export type SetMemberDelegateInput = z.infer<typeof setMemberDelegateSchema>;

/** `GET /workspace/members/:id/leave`: the member panel's leave section in one read. */
export const memberLeaveOverviewSchema = z.object({
  memberId: uuidSchema,
  memberName: z.string(),
  today: leaveDaySchema,
  timezone: z.string(),
  /** The ongoing leave, if any. */
  current: memberLeaveSchema.nullable(),
  /** Leaves that have not started, soonest first. */
  upcoming: z.array(memberLeaveSchema),
  delegate: memberDelegateSchema.nullable(),
  /** What would be stranded while they are away: for the "Reassign" shortcut. Counted live; null when the caller may not know. */
  workload: z
    .object({
      ownedContacts: z.number().int().nonnegative(),
      openConversations: z.number().int().nonnegative(),
    })
    .nullable(),
  /** What the caller may do on this member. */
  can: z.object({ manage: z.boolean(), seeReason: z.boolean() }),
});
export type MemberLeaveOverview = z.infer<typeof memberLeaveOverviewSchema>;

/** The marker the pickers and the team screen show: "On leave until 20 Oct". */
export const onLeaveMarkSchema = z.object({
  /** Last day away, `YYYY-MM-DD`; null = open-ended. */
  until: leaveDaySchema.nullable(),
  /** Who stands in, when named and not away themselves (uuid). */
  delegateId: uuidSchema.nullable(),
});
export type OnLeaveMark = z.infer<typeof onLeaveMarkSchema>;

// --- events -------------------------------------------------------------------------------------------------------------------

export const MEMBER_LEAVE_STARTED = 'member.leave.started';
export const MEMBER_LEAVE_ENDED = 'member.leave.ended';
export const MEMBER_DELEGATE_CHANGED = 'member.delegate.changed';

/** Permission keys (`permission_defs`). `team.leave.manage` is record-scoped: `own` = yourself only, `all` = anyone. */
export const PERM_TEAM_LEAVE_READ = 'team.leave.read';
export const PERM_TEAM_LEAVE_MANAGE = 'team.leave.manage';
