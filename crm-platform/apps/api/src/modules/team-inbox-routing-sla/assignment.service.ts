import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  REALTIME_EVENT,
  type AssignConversationInput,
  type ConversationSummary,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  AudienceResolver,
  MemberDirectory,
  PERM_CONVERSATION_READ,
  RealtimeEmitter,
} from '../../realtime';
import {
  ConversationEventsRepository,
  ConversationsRepository,
  INBOX_PERMISSION as PERM,
  InboxAccess,
  InboxConversationsService,
  InboxRealtimePublisher,
  conversationNotFound,
  type LockedConversation,
} from '../team-inbox-conversations';

const MODULE_KEY = 'conversations';

const invalid = (message: string, path: string) =>
  new AppError(
    ERROR_CODES.CONVERSATION_ASSIGNEE_INVALID,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path, message }],
  );

/** A change `assignInTx` made, handed to `afterCommit`. Internal ids stay inside the process. */
export interface AssignmentChange {
  conversationUuid: string;
  rowVersion: number;
  before: { userId: number | null; teamId: number | null };
  after: { userId: number | null; teamId: number | null };
  afterUuids: { userId: string | null; teamId: string | null };
}

/**
 * How the person was chosen, for the timeline: `manual` is a human's choice; the others are the routing engine's (a rule's strategy,
 * or `contact_agent` for "keep returning contacts with their agent").
 */
export type AssignmentHow = 'manual' | 'round_robin' | 'least_busy' | 'specific' | 'contact_agent';

/** Who is assigning, for the timeline and the audit: a person, or the system (routing rules, escalation, flows, later). */
export type AssignmentActor =
  { kind: 'user'; userId: number } | { kind: 'system' | 'bot' | 'flow' };

/**
 * The only writer of a conversation's assignee columns (`assignee_user_id`, `assignee_team_id`, `assignee_agent_id`): the manual
 * route, and later bulk, kanban, routing rules, escalation and flows all come through here, so the rules below hold for every one.
 *
 * Phase 1 is the manual strategy: the caller names the person or the team. The rules, kept from WaDesk where they were right:
 *
 *  - The target must belong to this workspace: a user who is an ACTIVE member and may read the inbox (a person who could not open the
 *    conversation they were given would hold an item they cannot see), a team of this workspace. Otherwise 422, and the row is unchanged.
 *    WaDesk's "assign nobody" quirk is gone: omitting `userId` leaves the person, `null` clears them.
 *  - `inbox.conversation.assign` assigns anyone and unassigns; `inbox.conversation.assign_self` only claims (the caller's own id, no team).
 *  - A closed conversation becomes open when assigned (WaDesk); resolved, snoozed and spam keep their status.
 *  - Giving a thread to a person or a team takes it from an AI agent (`assignee_agent_id` cleared, an `ai_handoff` event).
 *  - The change, its timeline event, the audit row and the outbox event are one transaction; the realtime signals follow the commit.
 *  - Whoever loses sight of the conversation by this change is taken out of its room (`RealtimeEmitter.evict`) and told to drop the row.
 */
@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConversationsRepository,
    private readonly events: ConversationEventsRepository,
    private readonly conversations: InboxConversationsService,
    private readonly access: InboxAccess,
    private readonly directory: MemberDirectory,
    private readonly audience: AudienceResolver,
    private readonly emitter: RealtimeEmitter,
    private readonly publisher: InboxRealtimePublisher,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** `POST /inbox/conversations/:id/assign`. */
  async assign(uuid: string, input: AssignConversationInput): Promise<ConversationSummary> {
    const ctx = RequestContextStore.require();
    const done = await this.db.tx(async (tx) => {
      const locked = await this.repo.lockByUuid(tx, ctx.orgId, uuid);
      if (!locked) throw conversationNotFound();
      const viewer = await this.access.viewer(tx, ctx);
      this.access.assertVisible(viewer, locked);

      const me = await this.repo.userUuid(tx, ctx.orgId, ctx.userId!);
      const mayAssign = this.access.scopeOf(ctx, PERM.assign) !== null;
      if (mayAssign) {
        await this.access.assertCan(tx, ctx, PERM.assign, locked);
      } else {
        // Claim-only: the caller's own id and nothing else. Unassigning, giving it to a colleague or touching the team is `assign`.
        const claim =
          input.userId !== undefined && input.userId === me && input.teamId === undefined;
        if (!claim) throw AppError.forbidden(PERM.assign);
        await this.access.assertCan(tx, ctx, PERM.assignSelf, locked);
      }

      const target = await this.resolveTarget(tx, ctx.orgId, input);
      const next = {
        userId: target.userId === undefined ? locked.assigneeUserId : target.userId,
        teamId: target.teamId === undefined ? locked.assigneeTeamId : target.teamId,
      };
      const unchanged =
        next.userId === locked.assigneeUserId && next.teamId === locked.assigneeTeamId;
      // Assigning what is already assigned is a no-op (no event, no notification), checked before the version so a stale
      // double click still answers with the current row.
      if (unchanged) {
        return {
          change: null,
          summary: (await this.conversations.summaryInTx(tx, ctx.orgId, uuid))!,
        };
      }
      if (locked.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Conversation');

      const change = await this.assignInTx(
        tx,
        ctx.orgId,
        locked,
        {
          userId: next.userId,
          teamId: next.teamId,
          userUuid: target.userUuid,
          teamUuid: target.teamUuid,
        },
        { kind: 'user', userId: ctx.userId! },
      );
      const summary = (await this.conversations.summaryInTx(tx, ctx.orgId, uuid))!;
      return { change: { ...change, rowVersion: summary.rowVersion }, summary };
    });

    if (done.change) await this.afterCommit(ctx.orgId, done.change);
    return done.summary;
  }

  /**
   * The flow Assign step (WD-FLR-036): a flow hands the thread to a member and/or a team, with an optional note on the timeline
   * (`note_added`, source `flow`). The same target rules as the manual route (an ACTIVE member who can open the inbox, a team of this
   * workspace); a refused target throws CONVERSATION_ASSIGNEE_INVALID and changes nothing, and the node moves on. No permission check
   * (the flow's author decided), no row-version check, and handing over what is already assigned is a no-op. Strategy is always
   * `manual`: a team given without a member keeps the thread on the team (round robin inside a team is a later phase).
   * Runs as the system actor, inside the caller's request context for `orgId`.
   */
  async assignFromFlow(
    orgId: number,
    input: {
      conversationUuid: string;
      userId?: string | null;
      teamId?: string | null;
      note?: string;
    },
  ): Promise<{ changed: boolean }> {
    const done = await this.db.tx(async (tx) => {
      const locked = await this.repo.lockByUuid(tx, orgId, input.conversationUuid);
      if (!locked) throw conversationNotFound();
      const target = await this.resolveTarget(tx, orgId, {
        rowVersion: locked.rowVersion,
        strategy: 'manual',
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
      });
      const next = {
        userId: target.userId === undefined ? locked.assigneeUserId : target.userId,
        teamId: target.teamId === undefined ? locked.assigneeTeamId : target.teamId,
      };
      let change: AssignmentChange | null = null;
      if (next.userId !== locked.assigneeUserId || next.teamId !== locked.assigneeTeamId) {
        change = await this.assignInTx(
          tx,
          orgId,
          locked,
          { ...next, userUuid: target.userUuid, teamUuid: target.teamUuid },
          { kind: 'flow' },
        );
      }
      if (input.note) {
        await this.events.append(tx, orgId, {
          conversationId: locked.id,
          type: 'note_added',
          actorKind: 'flow',
          payload: { note: input.note.slice(0, 1024), source: 'flow' },
        });
      }
      return change;
    });
    if (done) await this.afterCommit(orgId, done);
    return { changed: done !== null };
  }

  /**
   * Writes the assignee columns for a locked conversation, with the timeline event, the audit row and the outbox event, inside the
   * caller's transaction. `locked` must come from `ConversationsRepository.lockByUuid` in that same transaction. The caller decides
   * who may do this (the route does; routing rules are the system); this method only enforces what must hold for every caller.
   *
   * `userUuid` / `teamUuid` are the wire ids of `userId` / `teamId` when they are set (events carry uuids).
   */
  async assignInTx(
    tx: Tx,
    orgId: number,
    locked: LockedConversation,
    next: {
      userId: number | null;
      teamId: number | null;
      userUuid: string | null;
      teamUuid: string | null;
    },
    actor: AssignmentActor,
    strategy: AssignmentHow = 'manual',
    /** More facts for the timeline event and the outbox event (the routing rule that decided). Uuids only. */
    meta: Record<string, unknown> = {},
  ): Promise<AssignmentChange> {
    const before = await this.summaryIds(tx, orgId, locked);
    const humanAssigned = next.userId !== null || next.teamId !== null;
    const takesFromAi = humanAssigned && locked.assigneeAgentId !== null;
    const reopens = locked.status === 'closed';

    await tx.execute(sql`
      UPDATE conversations SET
        assignee_user_id = ${next.userId},
        assignee_team_id = ${next.teamId},
        assignee_agent_id = ${takesFromAi ? null : sql`assignee_agent_id`},
        status = ${reopens ? 'open' : sql`status`},
        resolved_at = ${reopens ? null : sql`resolved_at`},
        resolved_by = ${reopens ? null : sql`resolved_by`}
      WHERE org_id = ${orgId} AND id = ${locked.id}`);

    const actorUserId = actor.kind === 'user' ? actor.userId : null;
    const eventType =
      next.userId === null &&
      locked.assigneeUserId !== null &&
      next.teamId === locked.assigneeTeamId
        ? 'unassigned'
        : locked.assigneeUserId !== null || locked.assigneeTeamId !== null
          ? 'reassigned'
          : 'assigned';
    const payload = {
      fromUserId: before.userUuid,
      toUserId: next.userUuid,
      fromTeamId: before.teamUuid,
      toTeamId: next.teamUuid,
      strategy,
      ...meta,
    };
    await this.events.append(tx, orgId, {
      conversationId: locked.id,
      type: eventType,
      actorKind: actor.kind,
      actorUserId,
      payload,
    });
    if (takesFromAi) {
      await this.events.append(tx, orgId, {
        conversationId: locked.id,
        type: 'ai_handoff',
        actorKind: actor.kind,
        actorUserId,
        payload: { reason: 'assigned_to_human', strategy },
      });
    }
    if (reopens) {
      await this.events.append(tx, orgId, {
        conversationId: locked.id,
        type: 'reopened',
        actorKind: actor.kind,
        actorUserId,
        payload: { from: 'closed', to: 'open', reason: 'assigned' },
      });
    }

    const byUuid = actorUserId === null ? null : await this.repo.userUuid(tx, orgId, actorUserId);
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: locked.id,
      eventType: 'conversation.assigned',
      // `toUserId: null` is an unassignment: one event type, so a consumer sees every change of who holds the thread.
      payload: { conversationId: locked.uuid, ...payload, byUserId: byUuid },
    });
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: locked.id,
      action: 'update',
      delta: {
        assigneeUserId: { old: before.userUuid, new: next.userUuid },
        assigneeTeamId: { old: before.teamUuid, new: next.teamUuid },
      },
    });

    return {
      conversationUuid: locked.uuid,
      rowVersion: locked.rowVersion + 1,
      before: { userId: locked.assigneeUserId, teamId: locked.assigneeTeamId },
      after: { userId: next.userId, teamId: next.teamId },
      afterUuids: { userId: next.userUuid, teamId: next.teamUuid },
    };
  }

  /**
   * Realtime, after the commit: `inbox.assignment` to everyone who may see the conversation now and to the people who just lost it
   * (their list drops the row), the same event to the conversation's room, an `upsert` signal, and eviction of whoever can no longer
   * see it, so they stop receiving its messages. Never throws.
   */
  async afterCommit(orgId: number, change: AssignmentChange): Promise<void> {
    try {
      const was = await this.audience.forConversation(orgId, {
        assigneeUserId: change.before.userId,
        assigneeTeamId: change.before.teamId,
      });
      const now = await this.audience.forConversation(orgId, {
        assigneeUserId: change.after.userId,
        assigneeTeamId: change.after.teamId,
      });
      const nowSet = new Set(now);
      const lost = was.filter((id) => !nowSet.has(id));
      const payload = {
        conversationId: change.conversationUuid,
        assigneeUserId: change.afterUuids.userId,
        assigneeTeamId: change.afterUuids.teamId,
      };
      await this.emitter.emitToUsers(orgId, [...now, ...lost], REALTIME_EVENT.assignment, payload);
      await this.emitter.emit(
        orgId,
        [{ kind: 'conv', id: change.conversationUuid }],
        REALTIME_EVENT.assignment,
        payload,
      );
      await this.publisher.conversationChanged(
        orgId,
        {
          uuid: change.conversationUuid,
          rowVersion: change.rowVersion,
          assigneeUserId: change.after.userId,
          assigneeTeamId: change.after.teamId,
        },
        ['assignment'],
        { alsoUserIds: lost },
      );
      for (const userId of lost) {
        await this.emitter.evict(orgId, userId, { kind: 'conv', id: change.conversationUuid });
      }
    } catch (err) {
      this.logger.warn({ err, orgId }, 'could not publish an assignment');
    }
  }

  // --- targets ----------------------------------------------------------------------------------------------------------------

  /** Names to internal ids, refusing anything that is not this workspace's. `undefined` stays `undefined` (leave it alone). */
  private async resolveTarget(
    tx: Tx,
    orgId: number,
    input: AssignConversationInput,
  ): Promise<{
    userId: number | null | undefined;
    userUuid: string | null;
    teamId: number | null | undefined;
    teamUuid: string | null;
  }> {
    let userId: number | null | undefined;
    let userUuid: string | null = null;
    if (input.userId === null) userId = null;
    else if (input.userId !== undefined) {
      const res = await tx.execute(
        sql`SELECT id FROM users WHERE org_id = ${orgId} AND uuid = ${input.userId} AND status = 'active'`,
      );
      const row = res.rows[0] as { id: string | number } | undefined;
      if (!row) throw invalid('That member is not part of this workspace.', 'userId');
      userId = Number(row.id);
      userUuid = input.userId;
      // Freshly resolved, not from the 30 second cache: this is the moment the answer must be current.
      const viewer = await this.directory.viewer(orgId, userId, PERM_CONVERSATION_READ);
      if (viewer.scope === null) {
        throw invalid(
          'That member cannot open the inbox, so they cannot be given a conversation.',
          'userId',
        );
      }
    }

    let teamId: number | null | undefined;
    let teamUuid: string | null = null;
    if (input.teamId === null) teamId = null;
    else if (input.teamId !== undefined) {
      const res = await tx.execute(
        sql`SELECT id FROM teams WHERE org_id = ${orgId} AND uuid = ${input.teamId}`,
      );
      const row = res.rows[0] as { id: string | number } | undefined;
      if (!row) throw invalid('That team is not part of this workspace.', 'teamId');
      teamId = Number(row.id);
      teamUuid = input.teamId;
    }
    return { userId, userUuid, teamId, teamUuid };
  }

  /** Wire ids of what the conversation is assigned to right now, for the timeline's "from". */
  private async summaryIds(
    tx: Tx,
    orgId: number,
    locked: LockedConversation,
  ): Promise<{ userUuid: string | null; teamUuid: string | null }> {
    const res = await tx.execute(sql`
      SELECT
        (SELECT uuid FROM users WHERE org_id = ${orgId} AND id = ${locked.assigneeUserId}) AS user_uuid,
        (SELECT uuid FROM teams WHERE org_id = ${orgId} AND id = ${locked.assigneeTeamId}) AS team_uuid`);
    const r = res.rows[0] as { user_uuid: string | null; team_uuid: string | null };
    return { userUuid: r.user_uuid, teamUuid: r.team_uuid };
  }
}
