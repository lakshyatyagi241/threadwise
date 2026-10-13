import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  consentChannelOfKind,
  GROWTH_ACTION_TYPES,
  type GrowthActionDecisionInput,
  type GrowthActionDecisionResult,
  type GrowthActionsQuery,
  type GrowthActionsResponse,
  type GrowthActionType,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { ContactConsentService } from '../contact-consent';
import { NotificationPublisher, NotificationsRepository } from '../notifications';
import { AssignmentService } from '../team-inbox-routing-sla';
import { GrowthGateService } from './growth-gate.service';
import { GrowthRepository, type ActionRow, type ActionWrite } from './growth.repository';

const MODULE = 'growth_actions';

/**
 * The Growth inbox: the things a person is asked to look at or approve. Raising an action is idempotent (one open action per key),
 * and accepting one does the real work of its kind through the owning module, as the person who accepted: routing a conversation goes
 * through the assignment service, an opt-out through the consent ledger. Dismissing changes nothing but the action.
 */
@Injectable()
export class GrowthActionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GrowthRepository,
    private readonly gate: GrowthGateService,
    private readonly audit: AuditService,
    private readonly assignment: AssignmentService,
    private readonly consent: ContactConsentService,
    private readonly notifications: NotificationsRepository,
    private readonly publisher: NotificationPublisher,
  ) {}

  // --- raising -----------------------------------------------------------------------------------------------------

  /** Writes an action unless the same one is already open. Returns whether a new one was written. */
  async raise(orgId: number, w: ActionWrite): Promise<boolean> {
    const id = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const made = await this.repo.insertAction(tx, orgId, w);
      if (made !== null) {
        await this.audit.record(tx, {
          module: MODULE,
          recordId: made,
          action: 'insert',
          delta: { type: { old: null, new: w.type } },
        });
      }
      return made;
    });
    return id !== null;
  }

  /** A bell notification for a person (the owner or assignee of a hot lead). Never throws: the action is the record. */
  async notify(
    orgId: number,
    userId: number,
    n: {
      title: string;
      body: string | null;
      conversationUuid: string | null;
      dedupeKey: string;
      contactName: string | null;
    },
  ): Promise<void> {
    try {
      const row = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.notifications.insertReturning(tx, orgId, {
          userId,
          type: 'new_lead',
          title: n.title,
          body: n.body,
          link: n.conversationUuid ? `/inbox?c=${n.conversationUuid}` : '/growth',
          data: { source: 'growth', contactName: n.contactName },
          dedupeKey: n.dedupeKey,
          ...(n.conversationUuid
            ? { subjectKind: 'conversation', subjectUuid: n.conversationUuid }
            : {}),
        }),
      );
      if (row) await this.publisher.created(orgId, row);
    } catch {
      // The notification is a courtesy; the action in the Growth inbox is what counts.
    }
  }

  // --- reading -----------------------------------------------------------------------------------------------------

  async list(orgId: number, q: GrowthActionsQuery): Promise<GrowthActionsResponse> {
    await this.gate.require(orgId);
    const { page, counts } = await this.db.txAs({ orgId, userId: null }, async (tx) => ({
      page: await this.repo.listActions(tx, orgId, q),
      counts: await this.repo.openByType(tx, orgId),
    }));
    const openByType = Object.fromEntries(
      GROWTH_ACTION_TYPES.map((t) => [t, counts[t] ?? 0]),
    ) as Record<GrowthActionType, number>;
    return {
      data: page.items,
      openByType,
      page: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: q.limit },
    };
  }

  // --- deciding ----------------------------------------------------------------------------------------------------

  async decide(input: GrowthActionDecisionInput): Promise<GrowthActionDecisionResult> {
    const ctx = RequestContextStore.require();
    await this.gate.require(ctx.orgId);
    const result: GrowthActionDecisionResult = { done: 0, failed: [] };
    for (const id of new Set(input.ids)) {
      try {
        const ok = await this.decideOne(ctx.orgId, ctx.userId ?? null, id, input.action);
        if (ok) result.done += 1;
        else result.failed.push({ id, code: ERROR_CODES.GRW_ACTION_GONE });
      } catch (err) {
        result.failed.push({ id, code: err instanceof AppError ? err.code : 'INTERNAL_ERROR' });
      }
    }
    return result;
  }

  private async decideOne(
    orgId: number,
    userId: number | null,
    uuid: string,
    action: 'accept' | 'dismiss',
  ): Promise<boolean> {
    const a = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.actionByUuid(tx, orgId, uuid),
    );
    if (!a) throw AppError.notFound('Action', uuid);
    if (a.status !== 'open') return false;
    if (action === 'accept') await this.perform(orgId, userId, a);
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const ok = await this.repo.decideAction(
        tx,
        orgId,
        a.id,
        action === 'accept' ? 'done' : 'dismissed',
        userId,
      );
      if (ok) {
        await this.audit.record(tx, {
          module: MODULE,
          recordId: a.id,
          action: 'update',
          delta: { status: { old: 'open', new: action === 'accept' ? 'done' : 'dismissed' } },
        });
      }
      return ok;
    });
  }

  /** What accepting means for each kind. Most are an acknowledgement; two change something, through the module that owns it. */
  private async perform(orgId: number, userId: number | null, a: ActionRow): Promise<void> {
    if (a.type === 'purchase_route') {
      const target = a.payload.userId;
      if (typeof target !== 'string' || !a.conversationUuid) {
        throw new AppError(
          ERROR_CODES.GRW_ACTION_GONE,
          'The conversation is no longer there.',
          409,
        );
      }
      const version = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.conversationVersion(tx, orgId, a.conversationUuid!),
      );
      if (version === null) throw AppError.notFound('Conversation', a.conversationUuid);
      // As the person who accepted: they need the right to assign this thread, like anywhere else.
      await this.assignment.assign(a.conversationUuid, {
        userId: target,
        rowVersion: version,
        strategy: 'manual',
      });
    }
    if (a.type === 'opt_out') {
      await this.db.txAs({ orgId, userId: null }, async (tx) => {
        const kind = a.conversationId
          ? await this.repo.channelKindOfConversation(tx, orgId, a.conversationId)
          : null;
        await this.consent.recordInTx(tx, orgId, {
          contactId: a.contactId,
          channel: (kind ? consentChannelOfKind(kind) : null) ?? 'whatsapp',
          action: 'withdrawn',
          source: 'inbound_message',
          actorUserId: userId,
          note: 'The contact asked to stop in the chat; confirmed by a person.',
          idempotencyKey: `growth-optout:${a.uuid}`,
        });
      });
    }
  }
}
