import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  TCHAT_ATTACHMENT_MAX_BYTES,
  TCHAT_SEARCH_LIMIT,
  type EditTchatMessageInput,
  type ListTchatMessagesQuery,
  type MarkTchatReadInput,
  type PostTchatMessageInput,
  type ReactTchatMessageInput,
  type TchatMessageListResponse,
  type TchatMessageResponse,
  type TchatReaction,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  decodeMessageCursor,
  encodeMessageCursor,
  escapeLike,
  extractMentionIds,
  safeFileName,
  sniffAttachment,
  withinEditWindow,
  isEmoji,
} from './chat-rules';
import { TeamChatAccess } from './team-chat-access.service';
import { toMessageResponse } from './team-chat.mapper';
import { TeamChatRepository, type MessageRow } from './team-chat.repository';

export const TCHAT_MESSAGE_MODULE = 'team_chat_messages';

export interface UploadedAttachment {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * Messages (WD-TCHAT-008..014, 016..020). One transaction per operation: the message, its attachment bytes, the channel's
 * `last_message_at`, the author's read pointer and the outbox events commit together or not at all.
 *
 * What differs from WaDesk (all in the inventory): the channel id is stored (WaDesk dropped it, so no message could ever be
 * read back); a message is plain text so search works; a burst bigger than one page is read in order, not skipped; an edit,
 * delete, pin or reaction needs access to the message's channel; a read pointer only moves forward; the attachment is checked
 * (type by its bytes, size) before anything is written.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TeamChatRepository,
    private readonly access: TeamChatAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // --- reads -----------------------------------------------------------------------------------------------------------

  async list(
    channelUuid: string,
    query: ListTchatMessagesQuery,
  ): Promise<TchatMessageListResponse> {
    const { orgId, userId } = this.access.actor();
    return this.db.tx(async (tx) => {
      const { channel } = await this.access.openChannel(tx, this.repo, channelUuid);

      if (query.after) {
        const anchor = await this.repo.messageByUuid(tx, orgId, query.after);
        if (!anchor || anchor.channelId !== channel.id)
          throw AppError.notFound('Message', query.after);
        const rows = await this.repo.historyAfter(tx, orgId, channel.id, anchor.id, query.limit);
        const hasMore = rows.length > query.limit;
        const items = hasMore ? rows.slice(0, query.limit) : rows;
        return {
          data: await this.assemble(tx, orgId, userId, items),
          // The poll asks again at once when a burst did not fit.
          page: { nextCursor: null, hasMore, limit: query.limit },
        };
      }

      let before: number | null = null;
      if (query.before) {
        before = decodeMessageCursor(query.before);
        if (before === null) throw AppError.validation('Invalid pagination cursor');
      }
      const rows = await this.repo.historyBefore(tx, orgId, channel.id, before, query.limit);
      const hasMore = rows.length > query.limit;
      const newestFirst = hasMore ? rows.slice(0, query.limit) : rows;
      const ascending = [...newestFirst].reverse();
      const oldest = ascending[0];
      return {
        data: await this.assemble(tx, orgId, userId, ascending),
        page: {
          nextCursor: hasMore && oldest ? encodeMessageCursor(oldest.id) : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  async pinned(channelUuid: string): Promise<{ data: TchatMessageResponse[] }> {
    const { orgId, userId } = this.access.actor();
    return this.db.tx(async (tx) => {
      const { channel } = await this.access.openChannel(tx, this.repo, channelUuid);
      const rows = await this.repo.pinnedMessages(tx, orgId, channel.id);
      return { data: await this.assemble(tx, orgId, userId, rows) };
    });
  }

  async search(channelUuid: string, q: string): Promise<{ data: TchatMessageResponse[] }> {
    const { orgId, userId } = this.access.actor();
    return this.db.tx(async (tx) => {
      const { channel } = await this.access.openChannel(tx, this.repo, channelUuid);
      const rows = await this.repo.searchMessages(
        tx,
        orgId,
        channel.id,
        `%${escapeLike(q)}%`,
        TCHAT_SEARCH_LIMIT,
      );
      return { data: await this.assemble(tx, orgId, userId, rows) };
    });
  }

  /** The bytes of a message's attachment, for the download route. */
  async attachment(
    messageUuid: string,
  ): Promise<{ bytes: Buffer; mime: string; name: string; isImage: boolean }> {
    const { orgId } = this.access.actor();
    return this.db.tx(async (tx) => {
      const msg = await this.repo.messageByUuid(tx, orgId, messageUuid);
      if (!msg || !msg.hasAttachment) throw AppError.notFound('Attachment', messageUuid);
      await this.access.openChannel(tx, this.repo, msg.channelUuid);
      const bytes = await this.repo.attachmentBytes(tx, orgId, msg.id);
      if (!bytes) throw AppError.notFound('Attachment', messageUuid);
      const mime = msg.attachmentMime ?? 'application/octet-stream';
      return {
        bytes,
        mime,
        name: msg.attachmentName ?? 'file',
        isImage: mime.startsWith('image/'),
      };
    });
  }

  // --- writes ----------------------------------------------------------------------------------------------------------

  async post(
    channelUuid: string,
    input: PostTchatMessageInput,
    file: UploadedAttachment | undefined,
  ): Promise<TchatMessageResponse> {
    const { orgId, userId } = this.access.actor();
    const body = input.body?.trim() || null;
    if (!body && !file) {
      throw new AppError(
        ERROR_CODES.TCHAT_EMPTY_MESSAGE,
        'Write a message or attach a file',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // Checked before anything is written, so a refused file leaves no row and no orphan (WaDesk stored it first).
    const sniffed = file ? this.checkAttachment(file) : null;

    return this.db.tx(async (tx) => {
      const { channel } = await this.access.openChannel(tx, this.repo, channelUuid);

      let replyToId: number | null = null;
      if (input.replyToId) {
        const parent = await this.repo.messageByUuid(tx, orgId, input.replyToId);
        if (!parent || parent.channelId !== channel.id) {
          throw new AppError(
            ERROR_CODES.TCHAT_REPLY_OTHER_CHANNEL,
            'You can only reply to a message in the same channel',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        replyToId = parent.id;
      }

      const mentionIds = body ? await this.resolveMentions(tx, orgId, body) : [];
      const created = await this.repo.insertMessage(tx, orgId, {
        channelId: channel.id,
        userId,
        body,
        mentionIds,
        replyToId,
        attachmentPath: file ? `blob:${randomUUID()}` : null,
        attachmentMime: sniffed?.mime ?? null,
        attachmentName: file ? safeFileName(file.originalname) : null,
      });
      if (file) await this.repo.insertAttachmentBlob(tx, orgId, created.id, file.buffer);
      await this.repo.touchChannel(tx, orgId, channel.id);
      await this.repo.advanceRead(tx, orgId, channel.id, userId, created.id);

      const mentionRefs = await this.repo.userRefs(tx, orgId, mentionIds);
      await this.outbox.emit(tx, {
        aggregateModule: TCHAT_MESSAGE_MODULE,
        aggregateId: created.id,
        eventType: 'teamchat.message.posted',
        payload: {
          uuid: created.uuid,
          channelId: channel.uuid,
          mentions: [...mentionRefs.values()],
        },
      });
      for (const [mentionedId, mentionedUuid] of mentionRefs) {
        if (mentionedId === userId) continue;
        await this.outbox.emit(tx, {
          aggregateModule: TCHAT_MESSAGE_MODULE,
          aggregateId: created.id,
          eventType: 'teamchat.mention.created',
          payload: { uuid: created.uuid, channelId: channel.uuid, mentionedUserId: mentionedUuid },
        });
      }

      const row = (await this.repo.messageById(tx, orgId, created.id))!;
      return (await this.assemble(tx, orgId, userId, [row]))[0]!;
    });
  }

  async edit(messageUuid: string, input: EditTchatMessageInput): Promise<TchatMessageResponse> {
    const { orgId, userId } = this.access.actor();
    return this.db.tx(async (tx) => {
      const msg = await this.requireMessage(tx, orgId, messageUuid);
      await this.access.openChannel(tx, this.repo, msg.channelUuid);
      if (msg.userId !== userId) throw this.notAuthor();
      if (!withinEditWindow(msg.createdAt, new Date())) {
        throw new AppError(
          ERROR_CODES.TCHAT_EDIT_WINDOW_EXPIRED,
          'Edit window expired (15 min)',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (msg.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('Message');
      // Mentions are read again (WaDesk kept the old list, so an edit could not add or drop a mention).
      const mentionIds = await this.resolveMentions(tx, orgId, input.body);
      const ok = await this.repo.updateBody(
        tx,
        orgId,
        msg.id,
        input.body,
        mentionIds,
        input.rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('Message');
      await this.audit.record(tx, {
        module: TCHAT_MESSAGE_MODULE,
        recordId: msg.id,
        action: 'update',
      });
      await this.outbox.emit(tx, {
        aggregateModule: TCHAT_MESSAGE_MODULE,
        aggregateId: msg.id,
        eventType: 'teamchat.message.edited',
        payload: { uuid: msg.uuid, channelId: msg.channelUuid },
      });
      const row = (await this.repo.messageById(tx, orgId, msg.id))!;
      return (await this.assemble(tx, orgId, userId, [row]))[0]!;
    });
  }

  /** The author deletes their own message; a holder of tchat.message.moderate deletes anyone's, in any channel. */
  async remove(messageUuid: string): Promise<void> {
    const { orgId, userId } = this.access.actor();
    const caps = await this.access.capabilities();
    await this.db.tx(async (tx) => {
      const msg = await this.requireMessage(tx, orgId, messageUuid);
      const own = msg.userId === userId;
      if (own) await this.access.openChannel(tx, this.repo, msg.channelUuid);
      else if (!caps.canModerate) throw this.notAuthor();
      await this.audit.record(tx, {
        module: TCHAT_MESSAGE_MODULE,
        recordId: msg.id,
        action: 'delete',
      });
      await this.outbox.emit(tx, {
        aggregateModule: TCHAT_MESSAGE_MODULE,
        aggregateId: msg.id,
        eventType: 'teamchat.message.deleted',
        payload: { uuid: msg.uuid, channelId: msg.channelUuid, byModerator: !own },
      });
      await this.repo.deleteMessage(tx, orgId, msg.id);
    });
  }

  /** Pins an unpinned message and unpins a pinned one. The author or a moderator may. */
  async togglePin(messageUuid: string): Promise<{ pinned: boolean }> {
    const { orgId, userId } = this.access.actor();
    const caps = await this.access.capabilities();
    return this.db.tx(async (tx) => {
      const msg = await this.requireMessage(tx, orgId, messageUuid);
      const own = msg.userId === userId;
      if (own) await this.access.openChannel(tx, this.repo, msg.channelUuid);
      else if (!caps.canModerate) {
        throw new AppError(
          ERROR_CODES.TCHAT_NOT_MESSAGE_AUTHOR,
          'Pin requires author or admin',
          HttpStatus.FORBIDDEN,
        );
      }
      const pinned = msg.pinnedAt === null;
      await this.repo.setPinned(tx, orgId, msg.id, pinned ? userId : null);
      await this.audit.record(tx, {
        module: TCHAT_MESSAGE_MODULE,
        recordId: msg.id,
        action: 'update',
        delta: { pinned: { old: !pinned, new: pinned } },
      });
      return { pinned };
    });
  }

  async react(
    messageUuid: string,
    input: ReactTchatMessageInput,
  ): Promise<{ reacted: boolean; reactions: TchatReaction[] }> {
    const { orgId, userId } = this.access.actor();
    if (!isEmoji(input.emoji)) {
      throw AppError.validation('Choose an emoji', [{ path: 'emoji', message: 'Not an emoji.' }]);
    }
    return this.db.tx(async (tx) => {
      const msg = await this.requireMessage(tx, orgId, messageUuid);
      await this.access.openChannel(tx, this.repo, msg.channelUuid);
      const reacted = await this.repo.toggleReaction(tx, orgId, msg.id, userId, input.emoji);
      const reactions =
        (await this.repo.reactionsFor(tx, orgId, [msg.id], userId)).get(msg.id) ?? [];
      return { reacted, reactions };
    });
  }

  /** Moves the caller's read pointer to the given message (or the newest) in a channel; it never moves back. */
  async markRead(channelUuid: string, input: MarkTchatReadInput): Promise<{ ok: true }> {
    const { orgId, userId } = this.access.actor();
    return this.db.tx(async (tx) => {
      const { channel } = await this.access.openChannel(tx, this.repo, channelUuid);
      let upTo: number;
      if (input.lastMessageId) {
        const msg = await this.repo.messageByUuid(tx, orgId, input.lastMessageId);
        if (!msg || msg.channelId !== channel.id)
          throw AppError.notFound('Message', input.lastMessageId);
        upTo = msg.id;
      } else {
        upTo = await this.repo.newestMessageId(tx, orgId, channel.id);
      }
      await this.repo.advanceRead(tx, orgId, channel.id, userId, upTo);
      return { ok: true as const };
    });
  }

  // --- helpers ---------------------------------------------------------------------------------------------------------

  private async requireMessage(tx: Tx, orgId: number, uuid: string): Promise<MessageRow> {
    const msg = await this.repo.messageByUuid(tx, orgId, uuid);
    if (!msg) throw AppError.notFound('Message', uuid);
    return msg;
  }

  private notAuthor(): AppError {
    return new AppError(
      ERROR_CODES.TCHAT_NOT_MESSAGE_AUTHOR,
      'Not your message',
      HttpStatus.FORBIDDEN,
    );
  }

  private checkAttachment(file: UploadedAttachment) {
    const reject = (message: string) =>
      new AppError(ERROR_CODES.TCHAT_ATTACHMENT_REJECTED, message, HttpStatus.UNPROCESSABLE_ENTITY);
    if (file.size > TCHAT_ATTACHMENT_MAX_BYTES) throw reject('The file is larger than 20 MB');
    const sniffed = sniffAttachment(file.buffer, file.originalname);
    if (!sniffed) throw reject('This file type is not allowed');
    return sniffed;
  }

  /** The mention tokens that name an active member of this workspace; the rest stay text and are not recorded. */
  private async resolveMentions(tx: Tx, orgId: number, body: string): Promise<number[]> {
    const wanted = extractMentionIds(body);
    if (wanted.length === 0) return [];
    const roster = await this.repo.roster(tx, orgId);
    const byUuid = new Map(roster.map((p) => [p.uuid, p.id]));
    return wanted.flatMap((uuid) => (byUuid.has(uuid) ? [byUuid.get(uuid)!] : []));
  }

  private async assemble(
    tx: Tx,
    orgId: number,
    me: number,
    rows: MessageRow[],
  ): Promise<TchatMessageResponse[]> {
    const userUuids = await this.repo.userRefs(tx, orgId, [
      ...new Set(rows.flatMap((r) => r.mentionIds)),
    ]);
    const reactions = await this.repo.reactionsFor(
      tx,
      orgId,
      rows.map((r) => r.id),
      me,
    );
    return rows.map((row) =>
      toMessageResponse(row, { me, userUuids, reactions: reactions.get(row.id) ?? [] }),
    );
  }
}
