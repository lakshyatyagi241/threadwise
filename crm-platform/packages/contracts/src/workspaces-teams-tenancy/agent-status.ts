import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { businessHoursDaysSchema, isIanaZone } from '../team-inbox-routing-sla/business-hours';
import { WSP_AVAILABILITY } from './members';

/**
 * The personal availability status ("Available / Away", the status pill of the top bar and of the Inbox sidebar) and the working hours
 * that can automate it. docs/specs/agent-status-bar.md.
 *
 * The stored value stays what it always was: `agent_statuses.status` is `online` or `offline` (and `busy`, which the menu no longer
 * offers but routing still honours). The words people read are Available and Away; `offline` is the stored word for Away. The person's
 * schedule and the record of their manual choice live in `agent_statuses.preferences` (no new column).
 *
 * What a person IS right now is one rule, `effectiveAgentStatus` (apps/api/src/common/agent-status.ts), used by routing, the pickers, the
 * handoff, Try it and these endpoints: manual choice, then leave, then working hours (only when the person automates and the plan has
 * `agent_status_automation`), then Available.
 */

/** Plan features (docs/specs/agent-status-bar.md, packaging section). */
export const AGENT_STATUS_BAR_FEATURE = 'agent_status_bar';
export const AGENT_STATUS_AUTOMATION_FEATURE = 'agent_status_automation';

/** Reason code the routing trace and the handoff trace carry for a person skipped because of their schedule. */
export const OUTSIDE_WORKING_HOURS_REASON = 'outside_working_hours';

export const AGENT_STATUS_STATES = ['available', 'away'] as const;
export const agentStatusStateSchema = z.enum(AGENT_STATUS_STATES);
export type AgentStatusState = z.infer<typeof agentStatusStateSchema>;

/**
 * Why the state is what it is. `manual`: the person chose it (or busy, or the inactivity sweep set it). `leave`: out of office.
 * `schedule`: outside their own working hours. `default`: nothing says otherwise (also an agent with no status row yet).
 */
export const AGENT_STATUS_REASONS = ['manual', 'leave', 'schedule', 'default'] as const;
export const agentStatusReasonSchema = z.enum(AGENT_STATUS_REASONS);
export type AgentStatusReason = z.infer<typeof agentStatusReasonSchema>;

/** The longest a stored schedule may be; only the shape is ours, the days are the workspace schedule's own schema. */
export const personalWorkingHoursSchema = z.object({
  /** "Automate my status": outside the hours the person is Away by themselves. */
  automate: z.boolean(),
  /** IANA zone the hours are in. */
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isIanaZone, { message: 'Not an IANA timezone.' }),
  days: businessHoursDaysSchema,
});
export type PersonalWorkingHours = z.infer<typeof personalWorkingHoursSchema>;

/** `PUT /workspace/members/me/working-hours` and `PUT /workspace/members/:id/working-hours`. */
export const updateMemberWorkingHoursSchema = personalWorkingHoursSchema.strict();
export type UpdateMemberWorkingHoursInput = z.infer<typeof updateMemberWorkingHoursSchema>;

/** `GET /workspace/members/me/working-hours` and `GET /workspace/members/:id/working-hours`. */
export const memberWorkingHoursSchema = z.object({
  memberId: uuidSchema,
  /** False until the person (or a manager) saved a schedule: the days and zone are then the suggestion shown in the dialog. */
  configured: z.boolean(),
  automate: z.boolean(),
  timezone: z.string(),
  /** The workspace's own zone, the prefill and the "reset" target. */
  workspaceTimezone: z.string(),
  days: businessHoursDaysSchema,
  /** Automation is on but no day is open: the person is never Away by schedule. The dialog warns. */
  emptySchedule: z.boolean(),
  /** Plan has `agent_status_automation`: saving is allowed. Reading is always allowed. */
  entitled: z.boolean(),
  /** The caller may change it (own hours, or `team.leave.manage` with a scope that reaches this person). */
  canEdit: z.boolean(),
  /** The effective state right now, so the dialog can say "You are Away outside your working hours". */
  status: z.object({
    state: agentStatusStateSchema,
    reason: agentStatusReasonSchema,
    changesAt: z.string().datetime().nullable(),
  }),
});
export type MemberWorkingHours = z.infer<typeof memberWorkingHoursSchema>;

/**
 * `GET /workspace/members/me/availability` (and the answer of the `PUT`). `status` keeps the old two-word answer (`online` / `offline`)
 * so an older client reading only that still works; it now carries the EFFECTIVE state.
 */
export const agentStatusSchema = z.object({
  status: z.enum(WSP_AVAILABILITY),
  state: agentStatusStateSchema,
  reason: agentStatusReasonSchema,
  /** The person's own choice is what decides (reason `manual`). */
  manual: z.boolean(),
  /** When the status changes by itself (next schedule boundary, or the end of a manual choice that expires); null = it does not. */
  changesAt: z.string().datetime().nullable(),
  /** Reason `leave`: the last day away (workspace calendar), null = open-ended. */
  leaveUntil: z.string().nullable(),
  hours: z.object({
    configured: z.boolean(),
    automate: z.boolean(),
    timezone: z.string().nullable(),
    emptySchedule: z.boolean(),
  }),
  /** What the plan unlocks for this workspace. */
  features: z.object({ bar: z.boolean(), automation: z.boolean() }),
});
export type AgentStatus = z.infer<typeof agentStatusSchema>;
