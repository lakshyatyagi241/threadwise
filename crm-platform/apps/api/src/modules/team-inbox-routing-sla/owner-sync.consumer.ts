import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { HANDOFF_GATES } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { pickDelegate } from '../../common/leave-delegate';
import { loadWorkspaceCalendar, onLeaveMap } from '../../common/workspace-calendar';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { MemberDirectory, PERM_CONVERSATION_READ } from '../../realtime';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { ConversationsRepository } from '../team-inbox-conversations';
import { AssignmentService } from './assignment.service';
import { HandoffRepository } from './handoff.repository';
import { RoutingRulesRepository } from './routing-rules.repository';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const AUTOMATIC_SOURCES = ['rule', 'owner', 'sticky', 'sync', 'system'];

/**
 * Keep in sync, contact owner to chat (BL-403, spec 4.5): when a contact owner changes (a person, a bulk edit, a reassign batch or its
 * restore, the record assignment engine), the open conversations of that contact follow, in the workspaces that chose the mode
 * `keep_in_sync` and whose plan has `inbox_assignment_sticky`.
 *
 * It only ever moves a conversation nobody took: unassigned, waiting, or assigned by an automatic source (`rule, owner, sticky, sync,
 * system`). A conversation a person claimed, was given, or that a flow named a person for is never touched. The new owner must be able to
 * open the inbox; while on leave their delegate carries the chat. The owner is read from the contact at delivery time, so a late or
 * repeated event converges to the same state, and a conversation already with the owner is a no-op (idempotent). Events the chat itself
 * wrote (`source` chat_claim or owner_sync) are ignored: one direction per trigger, no loop. Worker only.
 */
@Injectable()
export class OwnerSyncConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'chat-owner-sync';
  readonly eventTypes = ['contact.updated'] as const;
  private readonly logger = new Logger(OwnerSyncConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly db: DatabaseService,
    private readonly repo: HandoffRepository,
    private readonly routingRepo: RoutingRulesRepository,
    private readonly conversations: ConversationsRepository,
    private readonly assignment: AssignmentService,
    private readonly directory: MemberDirectory,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const source = str(event.payload.source);
    if (source === 'chat_claim' || source === 'owner_sync') return;
    const contactUuid = str(event.payload.uuid);
    if (!contactUuid) return;
    await RequestContextStore.run(
      {
        requestId: `owner-sync-${event.id}`,
        orgId: event.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.sync(event.orgId, contactUuid),
    );
  }

  /** Aligns the followable conversations of the contact with its current owner. Returns how many moved. */
  async sync(orgId: number, contactUuid: string, now: Date = new Date()): Promise<number> {
    if (!(await this.entitlements.featureEnabled(orgId, 'inbox_routing'))) return 0;
    if (!(await this.entitlements.featureEnabled(orgId, HANDOFF_GATES.keepInSync))) return 0;
    const plan = await this.db.txAs({ orgId }, async (tx) => {
      const settings = await this.repo.settings(tx, orgId);
      if (settings.ownerMode !== 'keep_in_sync') return null;
      const res = await tx.execute(
        sql`SELECT id, owner_id FROM contacts WHERE org_id = ${orgId} AND uuid = ${contactUuid}`,
      );
      const c = (
        res as unknown as { rows: Array<{ id: string | number; owner_id: string | number | null }> }
      ).rows[0];
      if (!c || c.owner_id === null) return null;
      const contactId = Number(c.id);
      return {
        ownerId: Number(c.owner_id),
        list: await this.repo.syncableConversations(tx, orgId, contactId),
      };
    });
    if (!plan || plan.list.length === 0) return 0;

    const viewers = await this.directory.viewers(orgId, PERM_CONVERSATION_READ);
    const canOpen = new Set(viewers.filter((v) => v.scope !== null).map((v) => v.userId));
    let moved = 0;
    for (const conv of plan.list) {
      const change = await this.db.txAs({ orgId }, async (tx) => {
        const locked = await this.conversations.lockByUuid(tx, orgId, conv.uuid);
        if (!locked || locked.status !== 'open' || locked.channelOwnerUserId !== null) return null;
        // Checked again under the lock: somebody may have taken it since the list was read.
        if (
          locked.assigneeUserId !== null &&
          !AUTOMATIC_SOURCES.includes(locked.assignedSource ?? '')
        ) {
          return null;
        }
        const today = (await loadWorkspaceCalendar(tx, orgId, now)).today;
        let target = plan.ownerId;
        if ((await onLeaveMap(tx, orgId, [target], today)).has(target)) {
          const d = (await this.routingRepo.delegatesOf(tx, orgId, [target])).get(target);
          const dAway = d ? await onLeaveMap(tx, orgId, [d.id], today) : new Map();
          const next = pickDelegate(
            new Map(d ? [[target, d.id]] : []),
            target,
            (x) => dAway.has(x),
            (x) => canOpen.has(x),
          );
          if (next === null) return null;
          target = next;
        }
        if (!canOpen.has(target) || locked.assigneeUserId === target) return null;
        const who = await this.routingRepo.activeUserById(tx, orgId, target);
        if (!who) return null;
        return this.assignment.assignInTx(
          tx,
          orgId,
          locked,
          { userId: who.id, teamId: locked.assigneeTeamId, userUuid: who.uuid, teamUuid: null },
          { kind: 'system' },
          'owner',
          { source: 'owner_sync' },
          { source: 'sync' },
        );
      });
      if (change) {
        moved += 1;
        await this.assignment.afterCommit(orgId, change);
      }
    }
    if (moved > 0) this.logger.debug({ orgId, moved }, 'conversations followed the contact owner');
    return moved;
  }
}
