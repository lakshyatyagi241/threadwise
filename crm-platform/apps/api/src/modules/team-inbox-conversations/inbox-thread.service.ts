import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ListMessagesQuery,
  type MessageListResponse,
  type MessageResponse,
  type SendMessageInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
  type OutboundContent,
} from '../chat-conversations';
import { ConversationsRepository } from './conversations.repository';
import { InboxAccess, PERM, conversationNotFound } from './inbox-access.service';
import { MediaUploadsRepository } from './media-uploads.repository';

/**
 * The thread an agent reads and writes in (TW-TIB1-010, 017, 019): reading messages, sending, retrying a failed send.
 *
 * The message pipeline (the stored `queued` row, the ledger, the dispatch queue, the worker, receipts) belongs to the conversation
 * core and is reached through `ConversationsFacade`. What is decided here is who may do it: the facade does not know about read
 * scopes, so every method first proves, in its own transaction, that the caller may see the conversation (404 otherwise) and, for a
 * write, that the permission's scope covers it (403).
 */
@Injectable()
export class InboxThreadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConversationsRepository,
    private readonly access: InboxAccess,
    private readonly uploads: MediaUploadsRepository,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async listMessages(uuid: string, query: ListMessagesQuery): Promise<MessageListResponse> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      const record = await this.repo.recordByUuid(tx, ctx.orgId, uuid);
      if (!record) throw conversationNotFound();
      this.access.assertVisible(viewer, record);
    });
    return this.conversations.listMessages(uuid, query);
  }

  /**
   * Answers with the stored `queued` message; the worker sends it. The same `clientMessageId` twice returns the first message and sends
   * once. An attachment is claimed for this send first, and handed back if the send is refused (window closed, plan cap, channel off).
   */
  async send(uuid: string, input: SendMessageInput): Promise<MessageResponse> {
    const ctx = RequestContextStore.require();
    if (input.kind === 'template') {
      throw new AppError(
        ERROR_CODES.INBOX_TEMPLATES_UNAVAILABLE,
        'Template messages are not available yet',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'kind', message: 'the template library is not part of this deployment' }],
      );
    }

    let claimed: { id: number; fresh: boolean } | null = null;
    const content = await this.db.tx(async (tx): Promise<OutboundContent> => {
      await this.assertCanReply(tx, ctx, uuid);
      if (input.kind === 'text') return { kind: 'text', body: input.body };

      const claim = await this.uploads.claim(
        tx,
        ctx.orgId,
        ctx.userId!,
        input.mediaId,
        input.clientMessageId,
      );
      if (!claim) {
        throw new AppError(
          ERROR_CODES.MESSAGE_MEDIA_NOT_FOUND,
          'That attachment was not found, has expired, or was already used',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'mediaId', message: 'upload the file again' }],
        );
      }
      claimed = { id: claim.row.id, fresh: claim.fresh };
      return {
        kind: 'media',
        media: {
          key: claim.row.mediaKey,
          mime: claim.row.mime,
          size: claim.row.sizeBytes,
          name: claim.row.name,
          sha256: claim.row.sha256,
        },
        caption: input.caption,
      };
    });

    try {
      const { message } = await this.conversations.enqueueOutbound({
        conversationId: uuid,
        clientMessageId: input.clientMessageId,
        content,
        replyToMessageId: input.replyToMessageId,
      });
      return message;
    } catch (err) {
      const mine = claimed as { id: number; fresh: boolean } | null;
      if (mine?.fresh) {
        await this.db
          .tx((tx) => this.uploads.release(tx, ctx.orgId, mine.id, input.clientMessageId))
          .catch(() => undefined);
      }
      throw err;
    }
  }

  /** Puts a failed outbound message back in the queue. The message is named, so the conversation is found through it. */
  async retry(messageUuid: string): Promise<MessageResponse> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      const record = await this.repo.recordByMessageUuid(tx, ctx.orgId, messageUuid);
      if (!record) {
        throw new AppError(
          ERROR_CODES.MESSAGE_NOT_FOUND,
          'Message not found',
          HttpStatus.NOT_FOUND,
        );
      }
      // The same answer as a message that does not exist: a message of a conversation the caller cannot see is not theirs to learn about.
      if (!this.access.canSee(viewer, record)) {
        throw new AppError(
          ERROR_CODES.MESSAGE_NOT_FOUND,
          'Message not found',
          HttpStatus.NOT_FOUND,
        );
      }
      await this.access.assertCan(tx, ctx, PERM.reply, record);
    });
    return this.conversations.retryOutbound(messageUuid);
  }

  private async assertCanReply(
    tx: Tx,
    ctx: ReturnType<typeof RequestContextStore.require>,
    uuid: string,
  ): Promise<void> {
    const viewer = await this.access.viewer(tx, ctx);
    const record = await this.repo.recordByUuid(tx, ctx.orgId, uuid);
    if (!record) throw conversationNotFound();
    this.access.assertVisible(viewer, record);
    await this.access.assertCan(tx, ctx, PERM.reply, record);
  }
}
