import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  MEMBER_DELEGATE_CHANGED,
  MEMBER_LEAVE_ENDED,
  MEMBER_LEAVE_STARTED,
  PERM_TEAM_LEAVE_MANAGE,
  type CreateMemberLeaveInput,
  type ListMemberLeavesQuery,
  type MemberLeave,
  type MemberLeaveList,
  type MemberLeaveOverview,
  type MemberLeaveStatus,
  type SetMemberDelegateInput,
  type UpdateMemberLeaveInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import {
  leaveCoversDay,
  loadWorkspaceCalendar,
  onLeaveMap,
} from '../../../common/workspace-calendar';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import {
  checkChangedRange,
  checkNewRange,
  earlyEndDay,
  mayManage,
  type LeaveScope,
} from './leave-rules';
import { LeaveRepository, type LeaveMember, type LeaveRow } from './leave.repository';

const OVERLAP_CONSTRAINT = 'excl_member_leaves_overlap';

const invalid = (message: string, path?: string) =>
  new AppError(
    ERROR_CODES.WSP_LEAVE_INVALID,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    path ? [{ path, message }] : undefined,
  );

const overlap = () =>
  new AppError(
    ERROR_CODES.WSP_LEAVE_OVERLAP,
    'This person already has leave that shares a day with these dates.',
    HttpStatus.CONFLICT,
    [{ path: 'startsOn', message: 'Overlaps another leave of this person.' }],
  );

/**
 * Member leave and the delegate (BL-112, docs/specs/contact-owner-leave-and-delegation.md). The person is "on leave" for a range of days
 * of the workspace's calendar; the dates are the truth, `status` follows through `LeaveSweepService` (scheduled -> active -> ended).
 *
 * Who may do what: `team.leave.manage` with a record scope. `own` (the Agent and Viewer presets) = only for themselves, so nobody has to
 * wait for a manager to tell the team they are away; `team` = themselves and a teammate; `all` (Manager and above) = anyone. The reason
 * is shown to the person and to whoever may manage that person, never to colleagues. Reading dates needs only `team.leave.read`.
 *
 * Every change writes its audit row and its outbox event in the same transaction (`member.leave.started|ended`,
 * `member.delegate.changed`); a leave that begins today is announced immediately, a future one by the sweep when its day comes.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LeaveRepository,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
  ) {}

  // --- reads -------------------------------------------------------------------------------------------------------------------

  async list(query: ListMemberLeavesQuery): Promise<MemberLeaveList> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const cal = await loadWorkspaceCalendar(tx, ctx.orgId);
      let memberId: number | undefined;
      if (query.memberId) {
        const m = await this.repo.member(tx, ctx.orgId, query.memberId);
        if (!m) return { data: [], today: cal.today, timezone: cal.timezone };
        memberId = m.id;
      }
      const rows = await this.repo.list(tx, ctx.orgId, {
        view: query.view,
        memberId,
        limit: query.limit,
      });
      const data: MemberLeave[] = [];
      for (const r of rows) data.push(await this.toResponse(tx, ctx, r, cal.today));
      return { data, today: cal.today, timezone: cal.timezone };
    });
  }

  async overview(memberUuid: string): Promise<MemberLeaveOverview> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const member = await this.requireMember(tx, ctx.orgId, memberUuid);
      const cal = await loadWorkspaceCalendar(tx, ctx.orgId);
      const rows = await this.repo.list(tx, ctx.orgId, {
        view: 'open',
        memberId: member.id,
        limit: 50,
      });
      const may = await this.may(tx, ctx, member.id);
      const all: MemberLeave[] = [];
      for (const r of rows) all.push(await this.toResponse(tx, ctx, r, cal.today, may));
      const delegate = await this.repo.delegateOf(tx, ctx.orgId, member.id);
      const away = delegate
        ? await onLeaveMap(tx, ctx.orgId, [delegate.delegateId], cal.today)
        : new Map<number, string | null>();
      return {
        memberId: member.uuid,
        memberName: member.fullName,
        today: cal.today,
        timezone: cal.timezone,
        current: all.find((l) => l.onLeaveNow) ?? null,
        upcoming: all.filter((l) => !l.onLeaveNow && l.startsOn > cal.today),
        delegate:
          delegate && delegate.delegateStatus === 'active'
            ? {
                id: delegate.delegateUuid,
                name: delegate.delegateName,
                onLeaveNow: away.has(delegate.delegateId),
              }
            : null,
        workload: may ? await this.repo.workload(tx, ctx.orgId, member.id) : null,
        can: { manage: may, seeReason: may },
      };
    });
  }

  // --- leave -------------------------------------------------------------------------------------------------------------------

  async create(memberUuid: string, input: CreateMemberLeaveInput): Promise<MemberLeave> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const member = await this.requireMember(tx, ctx.orgId, memberUuid);
      await this.assertMay(tx, ctx, member.id);
      if (member.status !== 'active') {
        throw invalid('Leave can be set for active members only.');
      }
      const cal = await loadWorkspaceCalendar(tx, ctx.orgId);
      const endsOn = input.endsOn ?? null;
      const check = checkNewRange(cal.today, input.startsOn, endsOn);
      if (!check.ok) throw invalid(check.message!, check.path);
      if (await this.repo.overlapping(tx, ctx.orgId, member.id, input.startsOn, endsOn)) {
        throw overlap();
      }

      const begins = input.startsOn <= cal.today;
      let id: number;
      try {
        id = await this.repo.insert(tx, ctx.orgId, {
          userId: member.id,
          startsOn: input.startsOn,
          endsOn,
          reason: input.reason?.trim() || null,
          status: begins ? 'active' : 'scheduled',
          createdBy: ctx.userId ?? null,
        });
      } catch (err) {
        if (isOverlap(err)) throw overlap();
        throw err;
      }
      await this.audit(tx, ctx, member.id, 'member.leave.created', {
        startsOn: { old: null, new: input.startsOn },
        endsOn: { old: null, new: endsOn },
      });
      const row = (await this.byId(tx, ctx.orgId, id))!;
      if (begins) await this.announceStarted(tx, ctx.orgId, row, cal.timezone);
      return this.toResponse(tx, ctx, row, cal.today);
    });
  }

  async update(uuid: string, input: UpdateMemberLeaveInput): Promise<MemberLeave> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const leave = await this.repo.byUuid(tx, ctx.orgId, uuid, true);
      if (!leave) throw AppError.notFound('Leave', uuid);
      await this.assertMay(tx, ctx, leave.userId);
      if (leave.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Leave');

      const cal = await loadWorkspaceCalendar(tx, ctx.orgId);
      const next = {
        startsOn: input.startsOn ?? leave.startsOn,
        endsOn: input.endsOn === undefined ? leave.endsOn : input.endsOn,
        reason:
          input.reason === undefined
            ? leave.reason
            : input.reason === null
              ? null
              : input.reason.trim() || null,
      };
      const check = checkChangedRange(cal.today, leave, next);
      if (!check.ok) throw invalid(check.message!, check.path);
      if (
        await this.repo.overlapping(
          tx,
          ctx.orgId,
          leave.userId,
          next.startsOn,
          next.endsOn,
          leave.id,
        )
      ) {
        throw overlap();
      }

      // A scheduled leave moved to start today or earlier begins now.
      const startedNow = leave.status === 'scheduled' && next.startsOn <= cal.today;
      let ok: boolean;
      try {
        ok = await this.repo.update(tx, ctx.orgId, leave.id, leave.rowVersion, {
          ...next,
          status: startedNow ? 'active' : leave.status,
          startedNow,
        });
      } catch (err) {
        if (isOverlap(err)) throw overlap();
        throw err;
      }
      if (!ok) throw AppError.rowVersionConflict('Leave');

      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (next.startsOn !== leave.startsOn)
        delta.startsOn = { old: leave.startsOn, new: next.startsOn };
      if (next.endsOn !== leave.endsOn) delta.endsOn = { old: leave.endsOn, new: next.endsOn };
      if (next.reason !== leave.reason) delta.reason = { old: '(hidden)', new: '(hidden)' };
      await this.audit(tx, ctx, leave.userId, 'member.leave.updated', delta);
      const row = (await this.byId(tx, ctx.orgId, leave.id))!;
      if (startedNow) await this.announceStarted(tx, ctx.orgId, row, cal.timezone);
      return this.toResponse(tx, ctx, row, cal.today);
    });
  }

  /** `DELETE /workspace/leaves/:id`: a leave that has not begun is cancelled; one that has is ended now (the person is back today). */
  async end(uuid: string): Promise<MemberLeave> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const leave = await this.repo.byUuid(tx, ctx.orgId, uuid, true);
      if (!leave) throw AppError.notFound('Leave', uuid);
      await this.assertMay(tx, ctx, leave.userId);
      const cal = await loadWorkspaceCalendar(tx, ctx.orgId);

      if (leave.status === 'scheduled') {
        await this.repo.finish(tx, ctx.orgId, leave.id, 'cancelled', null);
        await this.audit(tx, ctx, leave.userId, 'member.leave.cancelled', {
          status: { old: 'scheduled', new: 'cancelled' },
        });
      } else if (leave.status === 'active') {
        const last = earlyEndDay(cal.today, leave.startsOn, leave.endsOn);
        await this.repo.finish(tx, ctx.orgId, leave.id, 'ended', last);
        await this.audit(tx, ctx, leave.userId, 'member.leave.ended', {
          status: { old: 'active', new: 'ended' },
          endsOn: { old: leave.endsOn, new: last },
        });
        const row = (await this.byId(tx, ctx.orgId, leave.id))!;
        await this.announceEnded(tx, ctx.orgId, row, cal.timezone, true);
      } else {
        throw invalid('This leave is already over.');
      }
      return this.toResponse(tx, ctx, (await this.byId(tx, ctx.orgId, leave.id))!, cal.today);
    });
  }

  // --- delegate ----------------------------------------------------------------------------------------------------------------

  async setDelegate(
    memberUuid: string,
    input: SetMemberDelegateInput,
  ): Promise<MemberLeaveOverview['delegate']> {
    const ctx = RequestContextStore.require();
    const result = await this.db.tx(async (tx) => {
      const member = await this.requireMember(tx, ctx.orgId, memberUuid);
      await this.assertMay(tx, ctx, member.id);
      const before = await this.repo.delegateOf(tx, ctx.orgId, member.id);

      if (input.delegateId === null) {
        if (!before) return null;
        await this.repo.clearDelegate(tx, ctx.orgId, member.id);
        await this.audit(tx, ctx, member.id, 'member.delegate.changed', {
          delegate: { old: before.delegateUuid, new: null },
        });
        await this.emitDelegateChanged(tx, ctx.orgId, member, before.delegateUuid, null);
        return null;
      }

      const delegate = await this.repo.member(tx, ctx.orgId, input.delegateId);
      if (!delegate || delegate.status !== 'active') {
        throw new AppError(
          ERROR_CODES.WSP_DELEGATE_INVALID,
          'The delegate must be an active member of this workspace.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'delegateId', message: 'Not an active member of this workspace.' }],
        );
      }
      if (delegate.id === member.id) {
        throw new AppError(
          ERROR_CODES.WSP_DELEGATE_INVALID,
          'Nobody can be their own delegate.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'delegateId', message: 'That is the same person.' }],
        );
      }
      // A circle: the delegate (or the delegate's delegate, and so on) already stands in for this person.
      if (await this.repo.chainReaches(tx, ctx.orgId, delegate.id, member.id)) {
        throw new AppError(
          ERROR_CODES.WSP_DELEGATE_CYCLE,
          'That would make a circle: the chosen person already has this person as their delegate.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'delegateId', message: 'Would create a circle of delegates.' }],
        );
      }
      if (before?.delegateId === delegate.id) {
        return { id: delegate.uuid, name: delegate.fullName };
      }
      await this.repo.setDelegate(tx, ctx.orgId, member.id, delegate.id, ctx.userId ?? null);
      await this.audit(tx, ctx, member.id, 'member.delegate.changed', {
        delegate: { old: before?.delegateUuid ?? null, new: delegate.uuid },
      });
      await this.emitDelegateChanged(
        tx,
        ctx.orgId,
        member,
        before?.delegateUuid ?? null,
        delegate.uuid,
      );
      return { id: delegate.uuid, name: delegate.fullName };
    });
    if (!result) return null;
    const away = await this.db.tx(async (tx) => {
      const cal = await loadWorkspaceCalendar(tx, ctx.orgId);
      const d = await this.repo.member(tx, ctx.orgId, result.id);
      const map = d ? await onLeaveMap(tx, ctx.orgId, [d.id], cal.today) : new Map();
      return d ? map.has(d.id) : false;
    });
    return { ...result, onLeaveNow: away };
  }

  // --- announcements (also used by the sweep) -------------------------------------------------------------------------------------

  async announceStarted(tx: Tx, orgId: number, leave: LeaveRow, timezone: string): Promise<void> {
    const load = await this.repo.workload(tx, orgId, leave.userId);
    const delegate = await this.repo.delegateOf(tx, orgId, leave.userId);
    await this.audit(
      tx,
      RequestContextStore.peek() ?? null,
      leave.userId,
      'member.leave.started',
      { startsOn: { old: null, new: leave.startsOn }, endsOn: { old: null, new: leave.endsOn } },
      orgId,
    );
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: 'members',
      aggregateId: leave.userId,
      eventType: MEMBER_LEAVE_STARTED,
      payload: {
        leaveId: leave.uuid,
        memberId: leave.userUuid,
        memberUserId: leave.userId,
        memberName: leave.userName,
        startsOn: leave.startsOn,
        endsOn: leave.endsOn,
        timezone,
        ownedContacts: load.ownedContacts,
        openConversations: load.openConversations,
        delegateId: delegate?.delegateUuid ?? null,
      },
    });
  }

  async announceEnded(
    tx: Tx,
    orgId: number,
    leave: LeaveRow,
    timezone: string,
    early: boolean,
  ): Promise<void> {
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: 'members',
      aggregateId: leave.userId,
      eventType: MEMBER_LEAVE_ENDED,
      payload: {
        leaveId: leave.uuid,
        memberId: leave.userUuid,
        memberUserId: leave.userId,
        startsOn: leave.startsOn,
        endsOn: leave.endsOn,
        timezone,
        early,
      },
    });
  }

  // --- helpers -----------------------------------------------------------------------------------------------------------------

  private async emitDelegateChanged(
    tx: Tx,
    orgId: number,
    member: LeaveMember,
    previous: string | null,
    next: string | null,
  ): Promise<void> {
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: 'members',
      aggregateId: member.id,
      eventType: MEMBER_DELEGATE_CHANGED,
      payload: { memberId: member.uuid, delegateId: next, previousDelegateId: previous },
    });
  }

  private byId(tx: Tx, orgId: number, id: number): Promise<LeaveRow | null> {
    return this.repo.byId(tx, orgId, id);
  }

  private async requireMember(tx: Tx, orgId: number, uuid: string): Promise<LeaveMember> {
    const m = await this.repo.member(tx, orgId, uuid);
    if (!m) throw AppError.notFound('Member', uuid);
    return m;
  }

  private scopeOf(ctx: ReturnType<typeof RequestContextStore.require>): LeaveScope | null {
    const can = this.rbac.can(ctx.grants ?? new Map(), PERM_TEAM_LEAVE_MANAGE);
    return can.allowed ? can.scope : null;
  }

  /** Whether the caller may manage this person's leave (and so also see the reason). */
  private async may(
    tx: Tx,
    ctx: ReturnType<typeof RequestContextStore.require>,
    targetId: number,
  ): Promise<boolean> {
    const scope = this.scopeOf(ctx);
    if (scope === null) return false;
    const shares =
      (scope === 'team' || scope === 'team_and_below') && ctx.userId !== targetId
        ? await this.repo.shareTeam(tx, ctx.orgId, ctx.userId!, targetId, scope === 'team_and_below')
        : false;
    return mayManage(scope, ctx.userId!, targetId, shares);
  }

  private async assertMay(
    tx: Tx,
    ctx: ReturnType<typeof RequestContextStore.require>,
    targetId: number,
  ): Promise<void> {
    if (!(await this.may(tx, ctx, targetId))) throw AppError.forbidden(PERM_TEAM_LEAVE_MANAGE);
  }

  private async toResponse(
    tx: Tx,
    ctx: ReturnType<typeof RequestContextStore.require>,
    r: LeaveRow,
    today: string,
    knownMay?: boolean,
  ): Promise<MemberLeave> {
    const may = knownMay ?? (await this.may(tx, ctx, r.userId));
    return {
      id: r.uuid,
      memberId: r.userUuid,
      memberName: r.userName,
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      reason: may ? r.reason : null,
      status: r.status as MemberLeaveStatus,
      onLeaveNow: leaveCoversDay(r, today),
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      rowVersion: r.rowVersion,
    };
  }

  private async audit(
    tx: Tx,
    ctx: {
      orgId?: number;
      actorId: number | null;
      actorType: string;
      requestId?: string | null;
    } | null,
    recordId: number,
    action: string,
    delta: Record<string, { old: unknown; new: unknown }>,
    orgId?: number,
  ): Promise<void> {
    const org = orgId ?? ctx?.orgId ?? RequestContextStore.orgId();
    await this.repo.audit(tx, {
      orgId: org,
      actorId: ctx?.actorId ?? null,
      actorType: ctx?.actorType ?? 'system',
      recordId,
      action,
      delta,
      requestId: ctx?.requestId ?? null,
    });
  }
}

/** The exclusion constraint decided a race the overlap pre-check could not see. */
const isOverlap = (err: unknown): boolean =>
  (err as { code?: string }).code === '23P01' &&
  (err as { constraint?: string }).constraint === OVERLAP_CONSTRAINT;
