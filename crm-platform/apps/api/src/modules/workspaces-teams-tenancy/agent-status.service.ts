import { Injectable } from '@nestjs/common';
import {
  AGENT_STATUS_AUTOMATION_FEATURE,
  AGENT_STATUS_BAR_FEATURE,
  MEMBER_AVAILABILITY_CHANGED,
  PERM_TEAM_LEAVE_MANAGE,
  type AgentStatus,
  type MemberWorkingHours,
  type SetWspAvailabilityInput,
  type UpdateMemberWorkingHoursInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  hasOpenDay,
  loadAgentStatuses,
  manualUntil,
  readAvailabilityPrefs,
  readStatusRow,
  writeAvailability,
  type AvailabilityPrefs,
  type LoadedStatus,
  type ManualChoice,
} from '../../common/agent-status';
import { defaultBusinessHoursDays } from '../../common/business-hours-schedule';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { loadWorkspaceCalendar } from '../../common/workspace-calendar';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { mayManage, type LeaveScope } from './leave/leave-rules';
import { LeaveRepository } from './leave/leave.repository';
import { MembersRepository } from './members.repository';

const LOCKED_MESSAGE =
  'Working hours that set your status automatically are not on your plan. Upgrade your plan to use them.';

/**
 * The personal availability status and the working hours that can automate it (docs/specs/agent-status-bar.md).
 *
 * What a person IS right now is `effectiveAgentStatus` (common/agent-status.ts); this service reads and writes the inputs:
 * `agent_statuses.status` (online / offline, the old stored words), and `preferences.availability` (the manual-choice record and the
 * schedule). No migration: the jsonb column was already there and nothing else used it.
 *
 *  - Setting your own status needs no permission key and no plan flag (the switch has been in the account menu for everyone since the
 *    start). Only the status bar's UI is `agent_status_bar`.
 *  - Reading hours: your own, always; someone else's with `team.leave.read` (every preset has it).
 *  - Saving hours needs the plan feature `agent_status_automation` (422 PLAN_FEATURE_LOCKED) and `team.leave.manage` with a scope that
 *    reaches the person: `own` (Agent, Viewer) = yourself, `all` (Manager and above) = anyone. Same keys and scopes as Time off.
 */
@Injectable()
export class AgentStatusService {
  constructor(
    private readonly db: DatabaseService,
    private readonly members: MembersRepository,
    private readonly leave: LeaveRepository,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  // --- the caller's status ------------------------------------------------------------------------------------------------

  async mine(): Promise<AgentStatus> {
    const ctx = RequestContextStore.require();
    const flags = await this.flags(ctx.orgId);
    return this.db.tx((tx) => this.statusOf(tx, ctx.orgId, ctx.userId!, flags));
  }

  /**
   * Available / Away for the caller only. It is a MANUAL choice: it beats leave and the schedule, and while the person automates it
   * lasts until the next schedule boundary (so Away is not forgotten for ever); otherwise until they change it. `offline` takes the agent
   * out of every automatic assignment; chats they already hold stay theirs.
   */
  async setMine(input: SetWspAvailabilityInput): Promise<AgentStatus> {
    const ctx = RequestContextStore.require();
    const flags = await this.flags(ctx.orgId);
    return this.db.tx(async (tx) => {
      const userId = ctx.userId!;
      const row = await readStatusRow(tx, ctx.orgId, userId, true);
      const prefs = readAvailabilityPrefs(row.preferences);
      const now = new Date();
      const before = await this.effective(tx, ctx.orgId, userId, flags, now);
      const manual: ManualChoice = {
        status: input.status,
        setAt: now.toISOString(),
        until: manualUntil(prefs.hours, flags.automation, now),
      };
      await writeAvailability(tx, ctx.orgId, userId, {
        status: input.status,
        availability: { manual, ...(prefs.hours ? { hours: prefs.hours } : {}) },
      });
      const after = await this.effective(tx, ctx.orgId, userId, flags, now);
      const storedBefore = row.status === 'offline' ? 'offline' : 'online';
      if (storedBefore !== input.status || before.state !== after.state) {
        await this.members.audit(tx, {
          orgId: ctx.orgId,
          actorId: ctx.actorId,
          actorType: ctx.actorType,
          module: 'members',
          recordId: userId,
          action: 'member.availability_changed',
          delta: { availability: { old: before.state, new: after.state } },
          requestId: ctx.requestId,
        });
        // Routing reacts to a person going away (the away rules): ids only, the consumer reads the rest.
        await this.outbox.emit(tx, {
          aggregateModule: 'members',
          aggregateId: userId,
          orgId: ctx.orgId,
          eventType: MEMBER_AVAILABILITY_CHANGED,
          payload: { userId, status: input.status, reason: 'self' },
        });
      }
      return this.statusOf(tx, ctx.orgId, userId, flags, now);
    });
  }

  // --- working hours ------------------------------------------------------------------------------------------------------

  async hoursOfMe(): Promise<MemberWorkingHours> {
    const ctx = RequestContextStore.require();
    const flags = await this.flags(ctx.orgId);
    return this.db.tx(async (tx) => {
      const me = await this.leave.memberById(tx, ctx.orgId, ctx.userId!);
      if (!me) throw AppError.notFound('Member', String(ctx.userId));
      const canEdit = await this.may(tx, ctx, me.id);
      return this.hoursOf(tx, ctx.orgId, me, flags, canEdit);
    });
  }

  async hoursOfMember(uuid: string): Promise<MemberWorkingHours> {
    const ctx = RequestContextStore.require();
    const flags = await this.flags(ctx.orgId);
    return this.db.tx(async (tx) => {
      const target = await this.requireMember(tx, ctx.orgId, uuid);
      const canEdit = await this.may(tx, ctx, target.id);
      return this.hoursOf(tx, ctx.orgId, target, flags, canEdit);
    });
  }

  async saveMine(input: UpdateMemberWorkingHoursInput): Promise<MemberWorkingHours> {
    const ctx = RequestContextStore.require();
    return this.save(ctx.userId!, null, input);
  }

  async saveMember(
    uuid: string,
    input: UpdateMemberWorkingHoursInput,
  ): Promise<MemberWorkingHours> {
    return this.save(null, uuid, input);
  }

  private async save(
    selfId: number | null,
    uuid: string | null,
    input: UpdateMemberWorkingHoursInput,
  ): Promise<MemberWorkingHours> {
    const ctx = RequestContextStore.require();
    await this.entitlements.assertFeature(
      ctx.orgId,
      AGENT_STATUS_AUTOMATION_FEATURE,
      LOCKED_MESSAGE,
    );
    const flags = await this.flags(ctx.orgId);
    return this.db.tx(async (tx) => {
      const target =
        selfId !== null
          ? await this.leave.memberById(tx, ctx.orgId, selfId)
          : await this.leave.member(tx, ctx.orgId, uuid!);
      if (!target) throw AppError.notFound('Member', uuid ?? String(selfId));
      if (!(await this.may(tx, ctx, target.id))) throw AppError.forbidden(PERM_TEAM_LEAVE_MANAGE);

      const row = await readStatusRow(tx, ctx.orgId, target.id, true);
      const prefs = readAvailabilityPrefs(row.preferences);
      const now = new Date();
      const before = await this.effective(tx, ctx.orgId, target.id, flags, now);

      // A manual choice that already ended under the OLD schedule is cleaned up, not revived by the new one.
      let manual = prefs.manual;
      let status: 'online' | 'offline' | undefined;
      const oldActive = before.automationActive;
      const expired =
        oldActive && manual?.until != null && now.getTime() >= Date.parse(manual.until);
      if (expired) {
        manual = null;
        if (row.status === 'offline') status = 'online';
      }
      // Away set before the schedule existed (or by the inactivity sweep) has no record: it gets one, so it can end at a boundary.
      if (!manual && row.status === 'offline' && !expired) {
        manual = { status: 'offline', setAt: now.toISOString(), until: null };
      }
      if (manual) {
        manual = { ...manual, until: manualUntil(input, flags.automation, now) };
      }

      const availability: AvailabilityPrefs = { hours: input, ...(manual ? { manual } : {}) };
      await writeAvailability(tx, ctx.orgId, target.id, {
        ...(status ? { status } : {}),
        availability,
      });
      await this.members.audit(tx, {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        module: 'members',
        recordId: target.id,
        action: 'member.working_hours_changed',
        delta: {
          workingHours: {
            old: prefs.hours
              ? { automate: prefs.hours.automate, timezone: prefs.hours.timezone }
              : null,
            new: { automate: input.automate, timezone: input.timezone },
          },
        },
        requestId: ctx.requestId,
      });
      return this.hoursOf(tx, ctx.orgId, target, flags, true, now);
    });
  }

  // --- helpers ------------------------------------------------------------------------------------------------------------

  private async flags(orgId: number): Promise<{ automation: boolean; bar: boolean }> {
    const [automation, bar] = await Promise.all([
      this.entitlements.featureEnabled(orgId, AGENT_STATUS_AUTOMATION_FEATURE),
      this.entitlements.featureEnabled(orgId, AGENT_STATUS_BAR_FEATURE),
    ]);
    return { automation, bar };
  }

  private async effective(
    tx: Tx,
    orgId: number,
    userId: number,
    flags: { automation: boolean },
    now: Date,
  ): Promise<LoadedStatus> {
    const map = await loadAgentStatuses(tx, orgId, [userId], {
      automationAllowed: flags.automation,
      now,
      wantChangesAt: true,
    });
    return map.get(userId)!;
  }

  private async statusOf(
    tx: Tx,
    orgId: number,
    userId: number,
    flags: { automation: boolean; bar: boolean },
    now: Date = new Date(),
  ): Promise<AgentStatus> {
    const st = await this.effective(tx, orgId, userId, flags, now);
    const prefs = readAvailabilityPrefs((await readStatusRow(tx, orgId, userId)).preferences);
    return {
      status: st.state === 'available' ? 'online' : 'offline',
      state: st.state,
      reason: st.reason,
      manual: st.reason === 'manual',
      changesAt: st.changesAt ? st.changesAt.toISOString() : null,
      leaveUntil: st.reason === 'leave' ? st.leaveUntil : null,
      hours: {
        configured: prefs.hours !== null,
        automate: prefs.hours?.automate ?? false,
        timezone: prefs.hours?.timezone ?? null,
        emptySchedule: st.emptySchedule,
      },
      features: { bar: flags.bar, automation: flags.automation },
    };
  }

  private async hoursOf(
    tx: Tx,
    orgId: number,
    target: { id: number; uuid: string },
    flags: { automation: boolean },
    canEdit: boolean,
    now: Date = new Date(),
  ): Promise<MemberWorkingHours> {
    const prefs = readAvailabilityPrefs((await readStatusRow(tx, orgId, target.id)).preferences);
    const cal = await loadWorkspaceCalendar(tx, orgId, now);
    const st = await this.effective(tx, orgId, target.id, flags, now);
    return {
      memberId: target.uuid,
      configured: prefs.hours !== null,
      automate: prefs.hours?.automate ?? false,
      timezone: prefs.hours?.timezone ?? cal.timezone,
      workspaceTimezone: cal.timezone,
      days: prefs.hours?.days ?? defaultBusinessHoursDays(),
      emptySchedule: prefs.hours ? prefs.hours.automate && !hasOpenDay(prefs.hours) : false,
      entitled: flags.automation,
      canEdit,
      status: {
        state: st.state,
        reason: st.reason,
        changesAt: st.changesAt ? st.changesAt.toISOString() : null,
      },
    };
  }

  private async requireMember(tx: Tx, orgId: number, uuid: string) {
    const m = await this.leave.member(tx, orgId, uuid);
    if (!m) throw AppError.notFound('Member', uuid);
    return m;
  }

  /** Whether the caller may change this person's hours: `team.leave.manage` at a scope that reaches them (the Time off rule). */
  private async may(
    tx: Tx,
    ctx: ReturnType<typeof RequestContextStore.require>,
    targetId: number,
  ): Promise<boolean> {
    const can = this.rbac.can(ctx.grants ?? new Map(), PERM_TEAM_LEAVE_MANAGE);
    if (!can.allowed) return false;
    const scope = can.scope as LeaveScope;
    const shares =
      (scope === 'team' || scope === 'team_and_below') && ctx.userId !== targetId
        ? await this.leave.shareTeam(
            tx,
            ctx.orgId,
            ctx.userId!,
            targetId,
            scope === 'team_and_below',
          )
        : false;
    return mayManage(scope, ctx.userId!, targetId, shares);
  }
}
