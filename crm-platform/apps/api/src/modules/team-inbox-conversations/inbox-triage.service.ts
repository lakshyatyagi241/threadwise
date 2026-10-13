import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type ConversationStatus,
  type ConversationSummary,
  type SetConversationPriorityInput,
  type SnoozeConversationInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ConversationEventsRepository } from './conversation-events.repository';
import { toConversationSummary } from './conversation.mapper';
import { ConversationsRepository } from './conversations.repository';
import { InboxAccess, PERM, conversationNotFound } from './inbox-access.service';
import { InboxRealtimePublisher } from './inbox-realtime.publisher';

const MODULE_KEY = 'conversations';

/** A snooze parks a live thread: a resolved, closed or spam one has nothing to wait for. */
const SNOOZABLE: readonly ConversationStatus[] = ['open', 'pending', 'snoozed'];

interface Published {
  uuid: string;
  rowVersion: number;
  assigneeUserId: number | null;
  assigneeTeamId: number | null;
  channelOwnerUserId: number | null;
}

/**
 * Priority and snooze (`inbox.conversation.priority`, `inbox.conversation.snooze`), and the waking of a snoozed thread.
 *
 * Same discipline as the status route: the conversation is locked, a conversation the caller cannot see is a 404, the permission's own
 * scope must cover it (403), the caller's `rowVersion` must match (409), the change, its timeline event, the audit row and the
 * outbox event are one transaction, and the realtime signal follows the commit. Setting what is already set is a no-op.
 */
@Injectable()
export class InboxTriageService {
  private readonly logger = new Logger(InboxTriageService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConversationsRepository,
    private readonly events: ConversationEventsRepository,
    private readonly access: InboxAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly publisher: InboxRealtimePublisher,
  ) {}

  async setPriority(
    uuid: string,
    input: SetConversationPriorityInput,
  ): Promise<ConversationSummary> {
    const ctx = RequestContextStore.require();
    const result = await this.db.tx(async (tx) => {
      const locked = await this.repo.lockByUuid(tx, ctx.orgId, uuid);
      if (!locked) throw conversationNotFound();
      this.access.assertVisible(await this.access.viewer(tx, ctx), locked);
      await this.access.assertCan(tx, ctx, PERM.priority, locked);

      const before = (await this.repo.byUuid(tx, ctx.orgId, uuid))!;
      if (before.priority === input.priority) return { changed: false as const, row: before };
      if (locked.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Conversation');

      await this.repo.setPriority(tx, ctx.orgId, locked.id, input.priority);
      await this.events.append(tx, ctx.orgId, {
        conversationId: locked.id,
        type: 'priority_changed',
        actorUserId: ctx.userId,
        payload: { from: before.priority, to: input.priority },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: locked.id,
        eventType: 'conversation.priority_changed',
        payload: { conversationId: uuid, from: before.priority, to: input.priority },
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: locked.id,
        action: 'update',
        delta: { priority: { old: before.priority, new: input.priority } },
      });
      return { changed: true as const, row: (await this.repo.byUuid(tx, ctx.orgId, uuid))! };
    });
    if (result.changed) await this.publish(ctx.orgId, result.row, ['priority']);
    return toConversationSummary(result.row);
  }

  /** Park a live thread until `until` (it wakes by itself: `wakeDue`). Snoozing a snoozed thread moves the wake time. */
  async snooze(uuid: string, input: SnoozeConversationInput): Promise<ConversationSummary> {
    const ctx = RequestContextStore.require();
    const until = new Date(input.until);
    const result = await this.db.tx(async (tx) => {
      const locked = await this.repo.lockByUuid(tx, ctx.orgId, uuid);
      if (!locked) throw conversationNotFound();
      this.access.assertVisible(await this.access.viewer(tx, ctx), locked);
      await this.access.assertCan(tx, ctx, PERM.snooze, locked);

      const from = locked.status as ConversationStatus;
      const before = (await this.repo.byUuid(tx, ctx.orgId, uuid))!;
      if (
        from === 'snoozed' &&
        before.snoozedUntil &&
        Date.parse(before.snoozedUntil) === until.getTime()
      ) {
        return { changed: false as const, row: before };
      }
      if (locked.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Conversation');
      if (!SNOOZABLE.includes(from)) {
        throw new AppError(
          ERROR_CODES.CONVERSATION_STATUS_INVALID,
          `A ${from} conversation cannot be snoozed`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'status', message: `${from} -> snoozed is not allowed` }],
        );
      }

      await this.repo.snooze(tx, ctx.orgId, locked.id, until);
      await this.events.append(tx, ctx.orgId, {
        conversationId: locked.id,
        type: 'snoozed',
        actorUserId: ctx.userId,
        payload: { from, until: until.toISOString() },
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: locked.id,
        action: 'update',
        delta: {
          status: { old: from, new: 'snoozed' },
          snoozedUntil: { old: before.snoozedUntil, new: until.toISOString() },
        },
      });
      return { changed: true as const, row: (await this.repo.byUuid(tx, ctx.orgId, uuid))! };
    });
    if (result.changed) await this.publish(ctx.orgId, result.row, ['status', 'snoozedUntil']);
    return toConversationSummary(result.row);
  }

  /**
   * The sweep: every snoozed thread whose time has come is open again, with an `auto_unsnoozed` event. Spans every workspace
   * (privileged); safe on every worker at once (`SKIP LOCKED`) and safe to repeat. Returns how many it woke.
   */
  async wakeDue(batch = 100): Promise<number> {
    const woken = await this.db.privileged(async (tx) => {
      const due = await this.repo.lockDueSnoozed(tx, batch);
      for (const c of due) {
        await this.repo.wake(tx, c.orgId, c.id);
        await this.events.append(tx, c.orgId, {
          conversationId: c.id,
          type: 'auto_unsnoozed',
          actorKind: 'system',
          payload: { from: 'snoozed', to: 'open' },
        });
        await this.outbox.emit(tx, {
          orgId: c.orgId,
          aggregateModule: MODULE_KEY,
          aggregateId: c.id,
          eventType: 'conversation.reopened',
          payload: { conversationId: c.uuid, from: 'snoozed', by: 'system', reopenedBy: null },
        });
      }
      return due;
    });
    for (const c of woken) {
      await this.publish(c.orgId, { ...c, rowVersion: c.rowVersion + 1 }, [
        'status',
        'snoozedUntil',
      ]);
    }
    if (woken.length > 0) this.logger.log({ woken: woken.length }, 'woke snoozed conversations');
    return woken.length;
  }

  private async publish(orgId: number, row: Published, changed: string[]): Promise<void> {
    await this.publisher.conversationChanged(
      orgId,
      {
        uuid: row.uuid,
        rowVersion: row.rowVersion,
        assigneeUserId: row.assigneeUserId,
        assigneeTeamId: row.assigneeTeamId,
        channelOwnerUserId: row.channelOwnerUserId,
      },
      changed,
    );
  }
}
