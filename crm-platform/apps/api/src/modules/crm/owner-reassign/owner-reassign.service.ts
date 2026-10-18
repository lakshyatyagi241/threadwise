import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  OWNER_REASSIGN_APPLIED,
  OWNER_REASSIGN_RESTORED,
  OWNER_REASSIGN_RUN_MAX,
  OWNER_REASSIGN_UNDO_DAYS,
  type CreateOwnerReassignInput,
  type OwnerReassignBatch,
  type OwnerReassignListQuery,
  type OwnerReassignPreview,
  type RecordScope,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { loadWorkspaceCalendar, onLeaveMap } from '../../../common/workspace-calendar';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertOwnerWithinScope } from '../owner-scope';
import { ContactsRepository } from '../contacts/contacts.repository';
import { ContactTouchService } from '../lead-handling/contact-touch.service';
import { OwnerReassignRepository, type Actor, type BatchRow } from './owner-reassign.repository';

const invalid = (message: string, path?: string) =>
  new AppError(
    ERROR_CODES.WSP_REASSIGN_INVALID,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    path ? [{ path, message }] : undefined,
  );

const notRestorable = (message: string) =>
  new AppError(ERROR_CODES.WSP_REASSIGN_NOT_RESTORABLE, message, HttpStatus.CONFLICT);

/**
 * Reassign on demand, with an opt-in restore (BL-112 phase 2). Moves the contacts, and with `includeDeals` the OPEN deals, of one person
 * to a person, to the person's delegate, or round robin over a team, as ONE batch that can be undone for 14 days and can come back by
 * itself on a chosen day.
 *
 * The caller's record scope holds like a single edit: `own` may only move their own book to themselves, `team` within the team, `all`
 * anyone's to anyone (`assertOwnerWithinScope` for every target, and the person leaving must be inside the scope). Deals follow the
 * `record.deals.update` scope. Each moved contact or deal gets its audit row and its event, as `POST /contacts/bulk/owner` writes them.
 *
 * Restore returns the rows whose owner is still the one this batch placed there; the records carry the batch id (trigger, see the
 * migration) so "somebody changed it meanwhile" (a single edit, a bulk move, an import, a later batch) simply leaves it alone and
 * counts it in `notRestored`. A restore is refused to start when the person is no longer an active member (`restore_blocked`).
 */
@Injectable()
export class OwnerReassignService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: OwnerReassignRepository,
    private readonly contacts: ContactsRepository,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly touch: ContactTouchService,
  ) {}

  private actor(): Actor {
    const ctx = RequestContextStore.require();
    return { actorId: ctx.actorId, actorType: ctx.actorType, requestId: ctx.requestId ?? null };
  }

  async preview(fromUuid: string, scope: RecordScope): Promise<OwnerReassignPreview> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const from = await this.requireFrom(tx, ctx.orgId, fromUuid);
      await this.assertPersonInScope(tx, ctx, scope, from.id);
      const c = await this.repo.counts(tx, ctx.orgId, from.id);
      return { contacts: c.contacts, openDeals: c.openDeals, runMax: OWNER_REASSIGN_RUN_MAX };
    });
  }

  async create(input: CreateOwnerReassignInput, scope: RecordScope): Promise<OwnerReassignBatch> {
    const ctx = RequestContextStore.require();
    const actor = this.actor();
    return this.db.tx(async (tx) => {
      const from = await this.requireFrom(tx, ctx.orgId, input.fromUserId);
      await this.repo.lockPerson(tx, ctx.orgId, from.id);
      await this.assertPersonInScope(tx, ctx, scope, from.id);
      const dealsScope = this.dealsScope(ctx);
      if (input.includeDeals) {
        if (dealsScope === null) throw AppError.forbidden('record.deals.update');
        await this.assertPersonInScope(tx, ctx, dealsScope, from.id);
      }
      const cal = await loadWorkspaceCalendar(tx, ctx.orgId);
      const restoreOn = input.restoreOn ?? null;
      if (restoreOn !== null && restoreOn <= cal.today) {
        throw invalid('The return day must be after today.', 'restoreOn');
      }

      const target = await this.resolveTargets(tx, ctx.orgId, from.id, input, cal.today);
      for (const id of target.userIds) {
        await this.assertTarget(tx, ctx, scope, id);
        if (input.includeDeals && dealsScope !== null)
          await this.assertTarget(tx, ctx, dealsScope, id);
      }

      const batchId = await this.repo.insert(tx, ctx.orgId, {
        fromUserId: from.id,
        toKind: input.target.kind,
        toUserId: input.target.kind === 'team' ? null : target.userIds[0]!,
        toTeamId: target.teamId,
        includeDeals: input.includeDeals,
        reason: input.reason?.trim() || null,
        restoreOn,
        undoDays: OWNER_REASSIGN_UNDO_DAYS,
        createdBy: ctx.userId ?? null,
      });

      await this.repo.announce(tx, batchId);
      const contacts = await this.repo.moveContacts(
        tx,
        ctx.orgId,
        from.id,
        target.userIds,
        OWNER_REASSIGN_RUN_MAX,
        actor,
        await this.touch.marksOnReassign(tx, ctx.orgId),
      );
      const deals = input.includeDeals
        ? await this.repo.moveDeals(
            tx,
            ctx.orgId,
            from.id,
            target.userIds,
            OWNER_REASSIGN_RUN_MAX,
            actor,
          )
        : 0;
      await this.repo.announce(tx, null);
      if (contacts + deals === 0) throw invalid('This person holds no contacts or open deals.');

      const left = await this.repo.counts(tx, ctx.orgId, from.id);
      const remaining = left.contacts + (input.includeDeals ? left.openDeals : 0);
      await this.repo.saveApplied(tx, ctx.orgId, batchId, { contacts, deals, remaining });
      await this.repo.audit(tx, {
        orgId: ctx.orgId,
        actor,
        recordId: from.id,
        action: 'owner.reassign.applied',
        delta: { contacts: { old: null, new: contacts }, deals: { old: null, new: deals } },
      });
      const row = await this.repo.byId(tx, ctx.orgId, batchId);
      await this.outbox.emit(tx, {
        aggregateModule: 'members',
        aggregateId: from.id,
        eventType: OWNER_REASSIGN_APPLIED,
        payload: {
          batchId: row.uuid,
          fromUserId: from.uuid,
          targetKind: input.target.kind,
          contacts,
          deals,
          restoreOn,
        },
      });
      return this.toResponse(row, true);
    });
  }

  async list(query: OwnerReassignListQuery): Promise<{ data: OwnerReassignBatch[] }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      let from: number | undefined;
      if (query.fromUserId) {
        const u = await this.repo.userStatus(tx, ctx.orgId, query.fromUserId);
        if (!u) return { data: [] };
        from = u.id;
      }
      const rows = await this.repo.list(tx, ctx.orgId, from, query.limit);
      return { data: rows.map((r) => this.toResponse(r, true)) };
    });
  }

  async get(uuid: string): Promise<OwnerReassignBatch> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Reassignment', uuid);
      return this.toResponse(row, true);
    });
  }

  /** `POST /owner-reassignments/:id/restore`: undo inside the window, or bring the work back early when a return was planned. */
  async restore(uuid: string, scope: RecordScope): Promise<OwnerReassignBatch> {
    const ctx = RequestContextStore.require();
    const actor = this.actor();
    return this.db.tx(async (tx) => {
      const batch = await this.repo.byUuid(tx, ctx.orgId, uuid, true);
      if (!batch) throw AppError.notFound('Reassignment', uuid);
      await this.repo.lockPerson(tx, ctx.orgId, batch.fromUserId);
      await this.assertPersonInScope(tx, ctx, scope, batch.fromUserId);
      if (batch.status !== 'applied')
        throw notRestorable('This reassignment was already restored.');
      if (!this.mayRestore(batch, new Date())) {
        throw notRestorable('The undo window has passed and no return was planned.');
      }
      const done = await this.restoreInTx(tx, ctx.orgId, batch, actor, ctx.userId ?? null);
      return this.toResponse(done, true);
    });
  }

  /** The restore itself, for the caller (scope checked) and for the sweep (system). Runs inside the caller's transaction. */
  async restoreInTx(
    tx: Tx,
    orgId: number,
    batch: BatchRow,
    actor: Actor,
    by: number | null,
  ): Promise<BatchRow> {
    if (batch.fromUserStatus !== 'active') {
      // Putting work back on somebody who has left would strand it again: leave it, say so.
      await this.repo.saveRestored(tx, orgId, batch.id, {
        status: 'restore_blocked',
        contacts: 0,
        deals: 0,
        notRestored: batch.movedContacts + batch.movedDeals,
        by,
      });
      return this.repo.byId(tx, orgId, batch.id);
    }
    await this.repo.announce(tx, null);
    const contacts = await this.repo.restoreContacts(tx, orgId, batch.id, batch.fromUserId, actor);
    const deals = batch.includeDeals
      ? await this.repo.restoreDeals(tx, orgId, batch.id, batch.fromUserId, actor)
      : 0;
    const notRestored = batch.movedContacts + batch.movedDeals - contacts - deals;
    await this.repo.saveRestored(tx, orgId, batch.id, {
      status: 'restored',
      contacts,
      deals,
      notRestored: Math.max(0, notRestored),
      by,
    });
    await this.repo.audit(tx, {
      orgId,
      actor,
      recordId: batch.fromUserId,
      action: 'owner.reassign.restored',
      delta: {
        contacts: { old: batch.movedContacts, new: contacts },
        deals: { old: batch.movedDeals, new: deals },
      },
    });
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: 'members',
      aggregateId: batch.fromUserId,
      eventType: OWNER_REASSIGN_RESTORED,
      payload: {
        batchId: batch.uuid,
        fromUserId: batch.fromUserUuid,
        contacts,
        deals,
        notRestored: Math.max(0, notRestored),
        automatic: by === null,
      },
    });
    return this.repo.byId(tx, orgId, batch.id);
  }

  // --- helpers -----------------------------------------------------------------------------------------------------------------

  private mayRestore(b: BatchRow, now: Date): boolean {
    return b.status === 'applied' && (now <= b.undoUntil || b.restoreOn !== null);
  }

  private async requireFrom(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; uuid: string }> {
    const u = await this.repo.userStatus(tx, orgId, uuid);
    if (!u) throw AppError.notFound('Member', uuid);
    return { id: u.id, uuid };
  }

  /** The person whose book moves must be inside the caller's scope: own = themselves, team = themselves or a teammate, all = anyone. */
  private async assertPersonInScope(
    tx: Tx,
    ctx: ReturnType<typeof RequestContextStore.require>,
    scope: RecordScope,
    personId: number,
  ): Promise<void> {
    if (scope === 'all' || !ctx.userId || personId === ctx.userId) return;
    if (
      scope === 'team' &&
      (await this.contacts.isOwnerInActorTeam(tx, ctx.orgId, ctx.userId, personId))
    )
      return;
    throw AppError.forbidden('record.contacts.update');
  }

  private assertTarget(
    tx: Tx,
    ctx: ReturnType<typeof RequestContextStore.require>,
    scope: RecordScope,
    targetId: number,
  ): Promise<void> {
    return assertOwnerWithinScope({
      scope,
      actorUserId: ctx.userId,
      nextOwnerId: targetId,
      inActorTeam: (id) => this.contacts.isOwnerInActorTeam(tx, ctx.orgId, ctx.userId!, id),
      path: 'ownerId',
    });
  }

  private dealsScope(ctx: ReturnType<typeof RequestContextStore.require>): RecordScope | null {
    const can = this.rbac.can(ctx.grants ?? new Map(), 'record.deals.update');
    return can.allowed ? can.scope : null;
  }

  private async resolveTargets(
    tx: Tx,
    orgId: number,
    fromId: number,
    input: CreateOwnerReassignInput,
    today: string,
  ): Promise<{ userIds: number[]; teamId: number | null }> {
    const t = input.target;
    if (t.kind === 'user') {
      const id = await this.contacts.resolveActiveUserId(tx, orgId, t.userId);
      if (id === undefined) throw AppError.notFound('User', t.userId);
      if (id === fromId) throw invalid('Choose somebody else.', 'target');
      return { userIds: [id], teamId: null };
    }
    if (t.kind === 'delegate') {
      const d = await tx.execute(
        sql`SELECT d.delegate_user_id AS id, u.status FROM member_delegates d
          JOIN users u ON u.org_id = d.org_id AND u.id = d.delegate_user_id
          WHERE d.org_id = ${orgId} AND d.user_id = ${fromId}`,
      );
      const row = d.rows[0] as { id: unknown; status: unknown } | undefined;
      if (!row || row.status !== 'active') throw invalid('This person has no delegate.', 'target');
      const id = Number(row.id);
      if ((await onLeaveMap(tx, orgId, [id], today)).has(id)) {
        throw invalid('Their delegate is on leave too.', 'target');
      }
      return { userIds: [id], teamId: null };
    }
    const members = await this.repo.teamMemberIds(tx, orgId, t.teamId);
    if (members === null) throw AppError.notFound('Team', t.teamId);
    const away = await onLeaveMap(tx, orgId, members, today);
    const pool = members.filter((id) => id !== fromId && !away.has(id));
    if (pool.length === 0)
      throw invalid('Nobody in this team is available to take the work.', 'target');
    return { userIds: pool, teamId: await this.repo.teamId(tx, orgId, t.teamId) };
  }

  private toResponse(r: BatchRow, mayAct: boolean): OwnerReassignBatch {
    return {
      id: r.uuid,
      fromUser: { id: r.fromUserUuid, name: r.fromUserName },
      target: {
        kind: r.toKind,
        userId: r.toUserUuid,
        userName: r.toUserName,
        teamId: r.toTeamUuid,
        teamName: r.toTeamName,
      },
      includeDeals: r.includeDeals,
      reason: r.reason,
      restoreOn: r.restoreOn,
      status: r.status,
      movedContacts: r.movedContacts,
      movedDeals: r.movedDeals,
      restoredContacts: r.restoredContacts,
      restoredDeals: r.restoredDeals,
      notRestored: r.notRestored,
      remaining: r.remaining,
      undoUntil: r.undoUntil.toISOString(),
      canRestore: mayAct && this.mayRestore(r, new Date()),
      createdAt: r.createdAt.toISOString(),
      restoredAt: r.restoredAt ? r.restoredAt.toISOString() : null,
    };
  }
}
