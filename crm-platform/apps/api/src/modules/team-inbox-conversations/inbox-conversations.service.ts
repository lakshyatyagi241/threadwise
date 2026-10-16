import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  canMoveConversationStatus,
  type ChannelCapabilities,
  type ConversationDetail,
  type ConversationGroupMembers,
  type ListConversationGroupMembersQuery,
  type ConversationListResponse,
  type ConversationStatus,
  type ConversationSummary,
  type InboxConversationDetail,
  type InboxCounts,
  type ListConversationsQuery,
  type MarkConversationReadInput,
  type MarkConversationReadResponse,
  type ServiceWindow,
  type SetConversationStatusInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { CHANNEL_ADAPTERS, type ChannelAdapter } from '../../infra/providers/chat-conversations';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import {
  CONVERSATIONS_FACADE,
  ChannelRegistryService,
  ChannelsFacade,
  CloudGroupThreadReader,
  PersonalGroupThreadReader,
  type ConversationsFacade,
} from '../chat-conversations';
import { ContactsRepository } from '../crm';
import { ConversationEventsRepository } from './conversation-events.repository';
import {
  toContactSummary,
  toConversationSummary,
  toPastConversation,
  iso,
} from './conversation.mapper';
import {
  ConversationsRepository,
  decodeListCursor,
  encodeListCursor,
  type InboxConversationRow,
} from './conversations.repository';
import { NotificationsService } from '../notifications';
import { InboxAccess, PERM, conversationNotFound } from './inbox-access.service';
import { InboxRealtimePublisher } from './inbox-realtime.publisher';

const MODULE_KEY = 'conversations';

/** What the composer is offered when a channel's adapter is not in this deployment: nothing can be sent through it. */
const NO_CAPABILITIES: ChannelCapabilities = {
  windowHours: null,
  templates: false,
  media: [],
  reactions: false,
  editDelete: false,
  receipts: [],
  typing: false,
};

/**
 * The agent's conversation list, counts, header and status changes (TW-TIB1-003, 004, 009, 034).
 *
 * Seeing a conversation is `conversationVisible` over the caller's read scope; a conversation outside it is a 404. The list and the
 * counts apply the same rule as a SQL condition (`visibleToSql`), so a badge always equals what the list shows.
 */
@Injectable()
export class InboxConversationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConversationsRepository,
    private readonly events: ConversationEventsRepository,
    private readonly access: InboxAccess,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly publisher: InboxRealtimePublisher,
    private readonly channels: ChannelsFacade,
    private readonly registry: ChannelRegistryService,
    private readonly contacts: ContactsRepository,
    @Inject(CHANNEL_ADAPTERS) private readonly adapters: ChannelAdapter[],
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
    private readonly notifications: NotificationsService,
    private readonly personalGroups: PersonalGroupThreadReader,
    private readonly cloudGroups: CloudGroupThreadReader,
  ) {}

  async list(query: ListConversationsQuery): Promise<ConversationListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);

      // A channel that is not in this workspace has no conversations: the filter must narrow to nothing, not be ignored.
      let channelId: number | undefined;
      if (query.channelId) {
        const channel = await this.channels.findByUuid(tx, ctx.orgId, query.channelId);
        if (!channel) {
          return {
            data: [],
            page: { nextCursor: null, hasMore: false, limit: query.limit },
            meta: { counts: await this.repo.counts(tx, ctx.orgId, viewer) },
          };
        }
        channelId = channel.id;
      }
      // Several channels (the Filters window): one that is not in this workspace is skipped, and when none is, nothing matches.
      let channelIds: number[] | undefined;
      if (query.channelIds.length > 0) {
        const found = await Promise.all(
          [...new Set(query.channelIds)].map((u) => this.channels.findByUuid(tx, ctx.orgId, u)),
        );
        channelIds = found.filter((c) => c !== null && c !== undefined).map((c) => c!.id);
        if (channelIds.length === 0) {
          return {
            data: [],
            page: { nextCursor: null, hasMore: false, limit: query.limit },
            meta: { counts: await this.repo.counts(tx, ctx.orgId, viewer) },
          };
        }
      }

      const rows = await this.repo.list(tx, ctx.orgId, viewer, {
        tab: query.tab,
        status: query.status,
        statuses: query.statuses,
        assignment: query.assignment,
        agentIds: [...new Set(query.agentIds)],
        sort: query.sort,
        from: query.from,
        to: query.to,
        channelId,
        channelIds,
        // `labels` is the original name of the `tags` query parameter; both are read.
        tagIds: [...new Set([...query.tags, ...query.labels])],
        tagScope: query.tagScope,
        q: query.q,
        archived: query.archived,
        limit: query.limit,
        cursor: query.cursor ? decodeListCursor(query.cursor) : undefined,
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map((r) => toConversationSummary(r)),
        page: {
          nextCursor:
            hasMore && last && last.lastMessageAt
              ? encodeListCursor({
                  pinnedAt: last.pinnedAt,
                  lastMessageAt: last.lastMessageAt,
                  id: last.id,
                })
              : null,
          hasMore,
          limit: query.limit,
        },
        meta: { counts: await this.repo.counts(tx, ctx.orgId, viewer, channelId) },
      };
    });
  }

  async counts(): Promise<InboxCounts> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      return this.repo.counts(tx, ctx.orgId, viewer);
    });
  }

  /** The row as the list shows it, with no visibility check: for a caller that has already made one (the assignment service). */
  async summaryInTx(tx: Tx, orgId: number, uuid: string): Promise<ConversationSummary | null> {
    const row = await this.repo.byUuid(tx, orgId, uuid);
    return row ? toConversationSummary(row) : null;
  }

  async detail(uuid: string): Promise<InboxConversationDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      const row = await this.repo.byUuid(tx, ctx.orgId, uuid);
      if (!row) throw conversationNotFound();
      this.access.assertVisible(viewer, row);

      const [{ capabilities, window }, contactSummary, past, personalGroup, cloudGroup] =
        await Promise.all([
          this.channelState(tx, ctx.orgId, row),
          this.contactSummary(tx, ctx, row),
          row.contactId === null
            ? Promise.resolve([])
            : this.repo.pastConversations(tx, ctx.orgId, viewer, row.contactId, row.id),
          this.personalGroups.stateOf(
            tx,
            ctx.orgId,
            { id: row.channelId, kind: row.channelKind },
            row.peerKey,
          ),
          this.cloudGroups.stateOf(
            tx,
            ctx.orgId,
            { id: row.channelId, kind: row.channelKind },
            row.peerKey,
          ),
        ]);

      const base: ConversationDetail = {
        ...toConversationSummary(row),
        capabilities,
        window,
        customerLanguage: row.customerLanguage,
        waitingSince: iso(row.waitingSince),
        firstResponseAt: iso(row.firstResponseAt),
        resolvedAt: iso(row.resolvedAt),
        ...(personalGroup ? { personalGroup } : {}),
        ...(cloudGroup ? { cloudGroup } : {}),
        sla: {
          firstResponseDueAt: iso(row.slaFirstResponseDue),
          resolutionDueAt: iso(row.slaResolutionDue),
          breached: row.slaBreached,
        },
      };
      return {
        ...base,
        contactSummary,
        pastConversations: past.map((p) => toPastConversation(p)),
      };
    });
  }

  /**
   * `GET .../group-members`: the members of a personal-number group thread, for the composer's @mention picker. Read from the directory
   * (`wa_device_groups.participants`), visibility-checked like the thread itself. Empty for any other thread.
   */
  async groupMembers(
    uuid: string,
    query: ListConversationGroupMembersQuery,
  ): Promise<ConversationGroupMembers> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      const row = await this.repo.byUuid(tx, ctx.orgId, uuid);
      if (!row) throw conversationNotFound();
      this.access.assertVisible(viewer, row);
      return this.personalGroups.members(
        tx,
        ctx.orgId,
        { id: row.channelId, kind: row.channelKind },
        row.peerKey,
        query,
      );
    });
  }

  /**
   * `POST .../read`: the visibility check is ours, the counter and the `inbox.unread` signal are the conversation core's, and the
   * person's bell rows about the thread are marked read here (`notification.read` goes to their other tabs).
   */
  async markRead(
    uuid: string,
    input: MarkConversationReadInput,
  ): Promise<MarkConversationReadResponse> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      const record = await this.repo.recordByUuid(tx, ctx.orgId, uuid);
      if (!record) throw conversationNotFound();
      this.access.assertVisible(viewer, record);
    });
    const { unreadCount } = await this.conversations.markRead(uuid, input.upToSeq);
    // The thread is read, so its bell rows are too (on every device), and an alert for a message that lands while it is open is skipped.
    await this.notifications.markConversationRead(uuid);
    return { conversationId: uuid, unreadCount };
  }

  /** Resolve, close, reopen, or park as pending, along the legal moves (`canMoveConversationStatus`). */
  async setStatus(uuid: string, input: SetConversationStatusInput): Promise<ConversationSummary> {
    const ctx = RequestContextStore.require();
    const result = await this.db.tx(async (tx) => {
      const locked = await this.repo.lockByUuid(tx, ctx.orgId, uuid);
      if (!locked) throw conversationNotFound();
      const viewer = await this.access.viewer(tx, ctx);
      this.access.assertVisible(viewer, locked);
      await this.access.assertCan(tx, ctx, PERM.resolve, locked);

      const from = locked.status as ConversationStatus;
      const to = input.status;
      // Resolving a resolved thread is a no-op, not a second resolution: no event, no counter, no notification.
      if (from === to) {
        return { changed: false as const, row: (await this.repo.byUuid(tx, ctx.orgId, uuid))! };
      }
      if (locked.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Conversation');
      if (!canMoveConversationStatus(from, to)) {
        throw new AppError(
          ERROR_CODES.CONVERSATION_STATUS_INVALID,
          `A ${from} conversation cannot be moved to ${to}`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'status', message: `${from} -> ${to} is not allowed` }],
        );
      }

      const finishing = to === 'resolved' || to === 'closed';
      const reopening = to === 'open' && (from === 'resolved' || from === 'closed');
      const wasFinished = from === 'resolved' || from === 'closed';
      await this.repo.setStatus(tx, ctx.orgId, locked.id, {
        status: to,
        // Resolved <-> closed keeps who finished it and when; finishing from a live status stamps the person; reopening clears both.
        resolvedAt: finishing ? (wasFinished ? 'keep' : 'now') : reopening ? null : 'keep',
        resolvedBy: finishing ? (wasFinished ? 'keep' : ctx.userId) : reopening ? null : 'keep',
        clearSnooze: from === 'snoozed',
      });

      const type = finishing ? to : reopening ? 'reopened' : 'status_changed';
      await this.events.append(tx, ctx.orgId, {
        conversationId: locked.id,
        type,
        actorUserId: ctx.userId,
        payload: { from, to },
      });

      const actorUuid = await this.repo.userUuid(tx, ctx.orgId, ctx.userId!);
      if (finishing && !wasFinished) {
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: locked.id,
          eventType: 'conversation.resolved',
          payload: { conversationId: uuid, status: to, from, resolvedBy: actorUuid },
        });
      } else if (reopening) {
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: locked.id,
          eventType: 'conversation.reopened',
          payload: { conversationId: uuid, from, by: 'agent', reopenedBy: actorUuid },
        });
      }
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: locked.id,
        action: 'update',
        delta: { status: { old: from, new: to } },
      });
      return { changed: true as const, row: (await this.repo.byUuid(tx, ctx.orgId, uuid))! };
    });

    if (result.changed) {
      await this.publisher.conversationChanged(
        ctx.orgId,
        {
          uuid,
          rowVersion: result.row.rowVersion,
          assigneeUserId: result.row.assigneeUserId,
          assigneeTeamId: result.row.assigneeTeamId,
          channelOwnerUserId: result.row.channelOwnerUserId,
        },
        ['status'],
      );
    }
    return toConversationSummary(result.row);
  }

  // --- pieces of the header ----------------------------------------------------------------------------------------------------

  /** What the channel can do and whether a free-form reply is allowed now, from the adapter that owns the rule. */
  private async channelState(
    tx: Tx,
    orgId: number,
    row: InboxConversationRow,
  ): Promise<{ capabilities: ChannelCapabilities; window: ServiceWindow }> {
    const summary = await this.channels.findById(tx, orgId, row.channelId);
    const adapter = summary ? this.adapters.find((a) => a.kind === summary.kind) : undefined;
    if (!summary || !adapter) {
      return { capabilities: NO_CAPABILITIES, window: { open: false, expiresAt: null } };
    }
    const channelRow = await this.registry.row(tx, orgId, summary.uuid);
    const runtime = await this.registry.runtime(tx, orgId, channelRow);
    const info = adapter.windowInfo(
      runtime,
      row.lastInboundAt ? new Date(row.lastInboundAt) : null,
      new Date(),
    );
    return {
      capabilities: summary.capabilities,
      window: {
        // A channel with no window rule never closes, whatever its adapter says about a customer who has not written yet.
        open: summary.capabilities.windowHours === null ? true : info.open,
        expiresAt: info.expiresAt ? info.expiresAt.toISOString() : null,
      },
    };
  }

  /** The linked contact, read through the contacts barrel. Callers who may not read contacts get none: the thread's name is all they need. */
  private async contactSummary(
    tx: Tx,
    ctx: { orgId: number; grants?: Map<string, { effect: 'allow' | 'deny'; scope: string }> },
    row: InboxConversationRow,
  ) {
    if (row.contactId === null) return null;
    const can = this.rbac.can(
      (ctx.grants ?? new Map()) as Parameters<RbacService['can']>[0],
      'record.contacts.read',
    );
    if (!can.allowed) return null;
    const contact = await this.contacts.findById(tx, ctx.orgId, row.contactId);
    if (!contact) return null;
    let ownerName: string | null = null;
    if (contact.ownerId !== null) {
      const res = await tx.execute(
        sql`SELECT full_name FROM users WHERE org_id = ${ctx.orgId} AND id = ${contact.ownerId}`,
      );
      ownerName = ((res.rows[0] as { full_name?: string } | undefined)?.full_name ?? null) as
        string | null;
    }
    const tagRes = await tx.execute(
      sql`SELECT t.uuid, t.name::text AS name, t.color FROM contact_tags ct
          JOIN tags t ON t.org_id = ct.org_id AND t.id = ct.tag_id
          WHERE ct.org_id = ${ctx.orgId} AND ct.contact_id = ${row.contactId} ORDER BY t.name`,
    );
    const contactTags = (
      tagRes.rows as Array<{ uuid: string; name: string; color: string | null }>
    ).map((r) => ({ id: r.uuid, name: r.name, color: r.color ?? null }));
    return toContactSummary(
      {
        uuid: contact.uuid,
        displayId: contact.displayId,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        lifecycleStage: contact.lifecycleStage,
        status: contact.status,
        source: contact.source,
        isUnsubscribed: contact.isUnsubscribed,
        whatsappSubscriptionStatus: contact.whatsappSubscriptionStatus,
        leadScore: contact.leadScore,
        leadScoreSource:
          contact.leadScoreSource === 'ai' ? 'ai' : contact.leadScore === null ? null : 'manual',
        leadScoreReasons: contact.leadScoreReasons,
        leadScoredAt: contact.leadScoredAt,
        leadScoreModel: contact.leadScoreModel,
        createdAt: contact.createdAt,
      },
      ownerName,
      contactTags,
    );
  }
}
