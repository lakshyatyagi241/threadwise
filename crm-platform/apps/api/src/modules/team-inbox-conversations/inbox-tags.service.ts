import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ApplyConversationTagInput,
  type ConversationSummary,
  type CreateInboxTagInput,
  type InboxTag,
  type InboxTagList,
  type UpdateInboxTagInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { TagsRepository, TagsService } from '../crm';
import { ConversationEventsRepository } from './conversation-events.repository';
import { toConversationSummary } from './conversation.mapper';
import { ConversationsRepository } from './conversations.repository';
import { InboxAccess, PERM, conversationNotFound } from './inbox-access.service';
import { InboxRealtimePublisher } from './inbox-realtime.publisher';
import { InboxTagsRepository, type InboxTagRow } from './inbox-tags.repository';

const MODULE_KEY = 'conversations';
const LIBRARY_MODULE = 'tags';

const tagNotFound = () =>
  new AppError(ERROR_CODES.INBOX_LABEL_NOT_FOUND, 'Tag not found', HttpStatus.NOT_FOUND);

const toTag = (r: InboxTagRow): InboxTag => ({
  id: r.uuid,
  name: r.name,
  color: r.color,
  description: r.description,
  conversationCount: r.conversationCount,
  rowVersion: r.rowVersion,
});

/**
 * Conversation tags (TW-TIB1-036, 037). The library is the workspace's tags (shared with contacts, as in Reference): creating and
 * deleting go through `TagsService` so the plan's tag limit, the unique name (ignoring case), the audit row and the outbox event are
 * the contacts domain's one rule; the inbox adds the description, the edit and the usage count. Putting a tag on a thread needs
 * `inbox.conversation.tag` over a conversation the caller can see; naming a tag that does not exist yet creates it and needs
 * `inbox.tag.manage` as well (Reference let an agent create one through the thread; the library right now guards it).
 */
@Injectable()
export class InboxTagsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConversationsRepository,
    private readonly tags: InboxTagsRepository,
    private readonly events: ConversationEventsRepository,
    private readonly access: InboxAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly publisher: InboxRealtimePublisher,
    private readonly tagsService: TagsService,
    private readonly tagsRepo: TagsRepository,
  ) {}

  // --- the library ------------------------------------------------------------------------------------------------------------

  async list(): Promise<InboxTagList> {
    const ctx = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.tags.list(tx, ctx.orgId));
    return { data: rows.map(toTag) };
  }

  async create(input: CreateInboxTagInput): Promise<InboxTag> {
    const ctx = RequestContextStore.require();
    const created = await this.tagsService.create({
      name: input.name,
      ...(input.color !== undefined ? { color: input.color } : {}),
    });
    return this.db.tx(async (tx) => {
      const row = (await this.tags.byUuid(tx, ctx.orgId, created.id))!;
      if (input.description) {
        await this.tags.setDescription(tx, ctx.orgId, row.id, input.description);
      }
      return toTag((await this.tags.byId(tx, ctx.orgId, row.id))!);
    });
  }

  async update(uuid: string, input: UpdateInboxTagInput): Promise<InboxTag> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.tags.byUuid(tx, ctx.orgId, uuid);
      if (!existing) throw tagNotFound();
      let updated: boolean;
      try {
        updated = await tx.transaction((sp) =>
          this.tags.update(sp, ctx.orgId, existing.id, input.rowVersion, {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.color !== undefined ? { color: input.color } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          }),
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(
            ERROR_CODES.CON_TAG_NAME_TAKEN,
            `A tag named "${input.name ?? existing.name}" already exists.`,
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      }
      if (!updated) throw AppError.rowVersionConflict('Tag');
      const row = (await this.tags.byId(tx, ctx.orgId, existing.id))!;
      await this.audit.record(tx, {
        module: LIBRARY_MODULE,
        recordId: existing.id,
        action: 'update',
        delta: {
          ...(row.name !== existing.name ? { name: { old: existing.name, new: row.name } } : {}),
          ...(row.color !== existing.color
            ? { color: { old: existing.color, new: row.color } }
            : {}),
          ...(row.description !== existing.description
            ? { description: { old: existing.description, new: row.description } }
            : {}),
        },
      });
      return toTag(row);
    });
  }

  /** Deleting a tag takes it off every conversation and every contact (it is the same tag). */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const exists = await this.db.tx((tx) => this.tags.byUuid(tx, ctx.orgId, uuid));
    if (!exists) throw tagNotFound();
    await this.tagsService.remove(uuid);
  }

  // --- on a conversation ------------------------------------------------------------------------------------------------------

  async apply(uuid: string, input: ApplyConversationTagInput): Promise<ConversationSummary> {
    return this.change(uuid, 'add', input);
  }

  async withdraw(uuid: string, tagId: string): Promise<ConversationSummary> {
    return this.change(uuid, 'remove', { tagId });
  }

  private async change(
    uuid: string,
    mode: 'add' | 'remove',
    input: ApplyConversationTagInput,
  ): Promise<ConversationSummary> {
    const ctx = RequestContextStore.require();
    const result = await this.db.tx(async (tx) => {
      const locked = await this.repo.lockByUuid(tx, ctx.orgId, uuid);
      if (!locked) throw conversationNotFound();
      this.access.assertVisible(await this.access.viewer(tx, ctx), locked);
      await this.access.assertCan(tx, ctx, PERM.tag, locked);

      const tag = await this.resolve(tx, ctx.orgId, input);
      const changed =
        mode === 'add'
          ? await this.tags.attach(tx, ctx.orgId, locked.id, tag.id, ctx.userId ?? null)
          : await this.tags.detach(tx, ctx.orgId, locked.id, tag.id);
      if (changed) {
        await this.tags.touchConversation(tx, ctx.orgId, locked.id);
        const type = mode === 'add' ? 'tag_added' : 'tag_removed';
        await this.events.append(tx, ctx.orgId, {
          conversationId: locked.id,
          type,
          actorUserId: ctx.userId,
          payload: { tagId: tag.uuid, name: tag.name },
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: locked.id,
          eventType: `conversation.${type}`,
          payload: { conversationId: uuid, tagId: tag.uuid, name: tag.name },
        });
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: locked.id,
          action: 'update',
          delta: {
            tags: mode === 'add' ? { old: null, new: tag.name } : { old: tag.name, new: null },
          },
        });
      }
      return { changed, row: (await this.repo.byUuid(tx, ctx.orgId, uuid))! };
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
        // `labels` is the original name of `tags`; both are sent so a client that watches either keeps working.
        ['tags', 'labels'],
      );
    }
    return toConversationSummary(result.row);
  }

  /** The tag named by id (404 for one of another workspace) or by name (found ignoring case, created when new: `inbox.tag.manage`). */
  private async resolve(
    tx: Tx,
    orgId: number,
    input: ApplyConversationTagInput,
  ): Promise<InboxTagRow> {
    if (input.tagId !== undefined) {
      const found = await this.tags.byUuid(tx, orgId, input.tagId);
      if (!found) throw tagNotFound();
      return found;
    }
    const name = input.name!.trim();
    const existing = await this.tagsRepo.findByName(tx, orgId, name);
    if (existing) return (await this.tags.byId(tx, orgId, existing.id))!;
    const ctx = RequestContextStore.require();
    if (this.access.scopeOf(ctx, 'inbox.tag.manage') === null) {
      throw new AppError(
        ERROR_CODES.INBOX_LABEL_CREATE_FORBIDDEN,
        'Creating a new tag needs the right to manage tags',
        HttpStatus.FORBIDDEN,
      );
    }
    const { row } = await this.tagsService.findOrCreateByName(tx, orgId, name, {
      enforcePermission: false,
    });
    return (await this.tags.byId(tx, orgId, row.id))!;
  }
}
