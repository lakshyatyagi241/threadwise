import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  normalizeShortcut,
  renderSavedReply,
  type CreateSavedReplyInput,
  type ListSavedRepliesQuery,
  type SavedReply,
  type SavedReplyListResponse,
  type UpdateSavedReplyInput,
  type UseSavedReplyInput,
  type UseSavedReplyResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore, type RequestContext } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { MergeTagService } from '../../crm';
import { PlanEntitlementService, PlanUsageService } from '../../plans-subscriptions-trials';
import { ConversationsRepository } from '../conversations.repository';
import { InboxAccess, PERM, conversationNotFound } from '../inbox-access.service';
import { toSavedReply } from './saved-replies.mapper';
import { SavedRepliesRepository, type SavedReplyRow } from './saved-replies.repository';
import {
  SAVED_REPLY_MANAGE,
  allowedOnChannel,
  buildLookup,
  canChange,
  isUniqueViolation,
  type ReplyCaller,
} from './saved-reply-rules';

const MODULE_KEY = 'saved_replies';
const COPY_SUFFIX = ' (copy)';

const notFound = (): AppError =>
  new AppError(ERROR_CODES.SAVED_REPLY_NOT_FOUND, 'Saved reply not found', HttpStatus.NOT_FOUND);
const shortcutTaken = (shortcut: string): AppError =>
  new AppError(
    ERROR_CODES.SAVED_REPLY_SHORTCUT_TAKEN,
    `The shortcut /${shortcut} is already used by another reply. Choose a different one.`,
    HttpStatus.CONFLICT,
    [{ path: 'shortcut', message: 'This shortcut is already in use' }],
  );
const notEditable = (): AppError =>
  new AppError(
    ERROR_CODES.SAVED_REPLY_NOT_EDITABLE,
    'Only people who manage saved replies can change a shared reply.',
    HttpStatus.FORBIDDEN,
  );

/**
 * Saved replies (TW-TIB1-024): the workspace library behind the composer's `/` picker and the Settings screen.
 *
 * Who may do what (Reference's rules, with the shared-reply gap closed): everyone who may reply sees the shared replies and their own
 * personal ones and can insert them (`use`); creating a reply, shared or personal, needs `inbox.savedreply.manage`; a shared reply is
 * changed or deleted only with that right, a personal one by its owner. The plan's `saved_replies` limit counts every reply of the
 * workspace, personal ones included (as Reference did), checked on create and duplicate. Every write is one transaction holding the
 * change, its audit row and its outbox event (`inbox.saved_reply.created|updated|deleted`).
 */
@Injectable()
export class SavedRepliesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SavedRepliesRepository,
    private readonly conversations: ConversationsRepository,
    private readonly access: InboxAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly usage: PlanUsageService,
    private readonly entitlements: PlanEntitlementService,
    private readonly mergeTags: MergeTagService,
  ) {}

  async list(query: ListSavedRepliesQuery): Promise<SavedReplyListResponse> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    const cap = await this.entitlements.limit(ctx.orgId, 'saved_replies');
    return this.db.tx(async (tx) => {
      const page = await this.repo.list(tx, ctx.orgId, caller.userId, query);
      const summary = await this.repo.summary(tx, ctx.orgId, caller.userId);
      return {
        data: page.rows.map((r) => toSavedReply(r, caller)),
        page: {
          nextCursor: page.nextCursor,
          hasMore: page.nextCursor !== null,
          limit: query.limit,
        },
        counts: {
          all: summary.shared + summary.mine,
          shared: summary.shared,
          mine: summary.mine,
        },
        categories: summary.categories,
        total: summary.total,
        limit: cap > 0 ? cap : null,
      };
    });
  }

  async get(uuid: string): Promise<SavedReply> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    return this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, ctx.orgId, caller.userId, uuid);
      if (!row) throw notFound();
      return toSavedReply(row, caller);
    });
  }

  async create(input: CreateSavedReplyInput): Promise<SavedReply> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    // The plan's cap counts every reply of the workspace, personal ones too, and is checked before anything else (422 PLAN_LIMIT_REACHED).
    return this.db.tx(async (tx) => {
      await this.usage.assertCanAddIn(tx, ctx.orgId, 'saved_replies');
      const ownerId = input.scope === 'mine' ? caller.userId : null;
      return this.insertCopy(tx, ctx, caller, {
        ownerId,
        shortcut: input.shortcut,
        title: input.title,
        body: input.body,
        category: input.category,
        language: input.language,
        channelKinds: input.channelKinds,
      });
    });
  }

  async update(uuid: string, input: UpdateSavedReplyInput): Promise<SavedReply> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    return this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, ctx.orgId, caller.userId, uuid, true);
      if (!row) throw notFound();
      if (!canChange(ownership(row), caller)) throw notEditable();
      if (Number(row.row_version) !== input.rowVersion)
        throw AppError.rowVersionConflict('Saved reply');

      const id = Number(row.id);
      const ownerId = ownership(row).userId;
      if (input.shortcut !== undefined && input.shortcut !== row.shortcut) {
        if (await this.repo.shortcutTaken(tx, ctx.orgId, ownerId, input.shortcut, id)) {
          throw shortcutTaken(input.shortcut);
        }
      }
      const before = toSavedReply(row, caller);
      let ok: boolean;
      try {
        ok = await this.repo.update(tx, ctx.orgId, id, input.rowVersion, {
          shortcut: input.shortcut,
          title: input.title,
          body: input.body,
          category: input.category,
          language: input.language,
          channelKinds: input.channelKinds,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw shortcutTaken(input.shortcut ?? before.shortcut);
        throw err;
      }
      if (!ok) throw AppError.rowVersionConflict('Saved reply');

      const after = toSavedReply(
        (await this.repo.byUuid(tx, ctx.orgId, caller.userId, uuid))!,
        caller,
      );
      const pick = (r: SavedReply) => ({
        shortcut: r.shortcut,
        title: r.title,
        body: r.body,
        category: r.category,
        language: r.language,
        channelKinds: r.channelKinds,
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: id,
        action: 'update',
        delta: this.audit.diff(pick(before), pick(after)),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'inbox.saved_reply.updated',
        payload: { savedReplyId: uuid, shortcut: after.shortcut, scope: after.scope },
      });
      return after;
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    await this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, ctx.orgId, caller.userId, uuid, true);
      if (!row) throw notFound();
      if (!canChange(ownership(row), caller)) throw notEditable();
      const id = Number(row.id);
      await this.repo.remove(tx, ctx.orgId, id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'inbox.saved_reply.deleted',
        payload: {
          savedReplyId: uuid,
          shortcut: row.shortcut as string,
          scope: row.user_id === null ? 'shared' : 'mine',
        },
      });
    });
  }

  /** A copy with the same scope and owner, `(copy)` after the title and the first free `_2`, `_3`... shortcut. Counts against the plan limit. */
  async duplicate(uuid: string): Promise<SavedReply> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    return this.db.tx(async (tx) => {
      await this.usage.assertCanAddIn(tx, ctx.orgId, 'saved_replies');
      const src = await this.repo.byUuid(tx, ctx.orgId, caller.userId, uuid);
      if (!src) throw notFound();
      const ownerId = ownership(src).userId;
      const shortcut = await this.repo.freeShortcut(tx, ctx.orgId, ownerId, src.shortcut as string);
      return this.insertCopy(tx, ctx, caller, {
        ownerId,
        shortcut,
        title: `${(src.title as string).slice(0, 128 - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
        body: src.body as string,
        category: (src.category as string | null) ?? null,
        language: (src.language as string | null) ?? null,
        channelKinds: (src.channel_kinds as string[]) ?? [],
      });
    });
  }

  /**
   * "Insert this reply into the conversation I have open": the text with its variables filled in from the conversation's contact, the
   * agent and the workspace, and the use counted. Sends nothing; the agent reads it in the composer first. The caller needs the right to
   * reply to THAT conversation (a conversation they cannot see is a 404), and a reply restricted to other channels is refused (422).
   */
  async use(uuid: string, input: UseSavedReplyInput): Promise<UseSavedReplyResponse> {
    const ctx = RequestContextStore.require();
    const caller = this.caller(ctx);
    return this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      const record = await this.conversations.recordByUuid(tx, ctx.orgId, input.conversationId);
      if (!record) throw conversationNotFound();
      this.access.assertVisible(viewer, record);
      await this.access.assertCan(tx, ctx, PERM.reply, record);

      const row = await this.repo.byUuid(tx, ctx.orgId, caller.userId, uuid);
      if (!row) throw notFound();
      const convo = await this.conversations.byUuid(tx, ctx.orgId, input.conversationId);
      if (!convo) throw conversationNotFound();
      if (!allowedOnChannel((row.channel_kinds as string[]) ?? [], convo.channelKind)) {
        throw new AppError(
          ERROR_CODES.SAVED_REPLY_CHANNEL_MISMATCH,
          'This reply is not meant for this kind of channel.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'conversationId', message: `Not available on ${convo.channelKind}` }],
        );
      }

      const base = await this.mergeTags.baseContext(tx, ctx.orgId);
      const contact =
        convo.contactId !== null
          ? await this.mergeTags.contactFor(tx, ctx.orgId, convo.contactId)
          : undefined;
      const channel = await this.repo.channelFacts(tx, ctx.orgId, convo.channelId);
      const { text, issues } = renderSavedReply(
        row.body as string,
        buildLookup({
          contact,
          base,
          peerName: convo.peerName,
          agentName: await this.repo.agentName(tx, ctx.orgId, caller.userId),
          deviceName: channel.name ?? convo.channelName,
          deviceAddress: channel.address,
        }),
      );
      const usedCount = await this.repo.bumpUsage(tx, ctx.orgId, Number(row.id));
      return { id: uuid, text, issues, usedCount };
    });
  }

  // --- pieces -----------------------------------------------------------------------------------------------------------------

  private caller(ctx: RequestContext): ReplyCaller {
    return {
      userId: ctx.userId!,
      canManage: this.rbac.can(ctx.grants ?? new Map(), SAVED_REPLY_MANAGE).allowed,
    };
  }

  private async insertCopy(
    tx: Tx,
    ctx: RequestContext,
    caller: ReplyCaller,
    v: {
      ownerId: number | null;
      shortcut: string;
      title: string;
      body: string;
      category: string | null;
      language: string | null;
      channelKinds: readonly string[];
    },
  ): Promise<SavedReply> {
    const shortcut = normalizeShortcut(v.shortcut);
    if (await this.repo.shortcutTaken(tx, ctx.orgId, v.ownerId, shortcut))
      throw shortcutTaken(shortcut);
    let created: { id: number; uuid: string };
    try {
      created = await this.repo.insert(tx, ctx.orgId, {
        ...v,
        shortcut,
        createdBy: caller.userId,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw shortcutTaken(shortcut);
      throw err;
    }
    await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: created.id,
      eventType: 'inbox.saved_reply.created',
      payload: {
        savedReplyId: created.uuid,
        shortcut,
        scope: v.ownerId === null ? 'shared' : 'mine',
      },
    });
    return toSavedReply(
      (await this.repo.byUuid(tx, ctx.orgId, caller.userId, created.uuid))!,
      caller,
    );
  }
}

const ownership = (row: SavedReplyRow) => ({
  userId: row.user_id === null ? null : Number(row.user_id),
});
