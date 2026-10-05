import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  INBOX_TEMPLATE_LIST_MAX,
  type InboxTemplateListResponse,
  type InboxTemplateOption,
  type ListInboxTemplatesQuery,
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
  ChannelsFacade,
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
  type OutboundContent,
} from '../chat-conversations';
import { TemplatesRepository } from '../message-templates';
import { ConversationsRepository } from './conversations.repository';
import { InboxAccess, PERM, conversationNotFound } from './inbox-access.service';
import {
  blockReason,
  bodySlots,
  buttonsOf,
  checkVariables,
  cleanVariables,
  isApproved,
  renderBody,
} from './inbox-template-rules';
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
    private readonly channels: ChannelsFacade,
    private readonly templates: TemplatesRepository,
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

    let claimed: { id: number; fresh: boolean } | null = null;
    const content = await this.db.tx(async (tx): Promise<OutboundContent> => {
      await this.assertCanReply(tx, ctx, uuid);
      if (input.kind === 'text') return { kind: 'text', body: input.body };
      if (input.kind === 'template') return this.templateContent(tx, ctx.orgId, uuid, input);

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

  /**
   * The approved templates this conversation's WhatsApp number can send, for the picker. A template of another number, one that is
   * not approved and one with nothing to send are left out; one the inbox cannot fill in is listed with the reason.
   */
  async listTemplates(
    uuid: string,
    query: ListInboxTemplatesQuery,
  ): Promise<InboxTemplateListResponse> {
    const ctx = RequestContextStore.require();
    const now = new Date();
    return this.db.tx(async (tx) => {
      await this.assertCanReply(tx, ctx, uuid);
      const wabaConfigId = await this.wabaConfigOf(tx, ctx.orgId, uuid);
      if (wabaConfigId === null) return { data: [], hasMore: false };
      // Narrowed to this number in SQL, so another number's templates never use up the page. `list` returns one row beyond the limit
      // when there are more: that row is how `hasMore` is known, and it is not sent.
      const rows = await this.templates.list(tx, ctx.orgId, {
        limit: INBOX_TEMPLATE_LIST_MAX,
        status: 'approved',
        providerConfigId: wabaConfigId,
        ...(query.q ? { q: query.q } : {}),
      });
      const hasMore = rows.length > INBOX_TEMPLATE_LIST_MAX;
      const data = rows
        .slice(0, INBOX_TEMPLATE_LIST_MAX)
        .filter((t) => isApproved(t))
        .map((t): InboxTemplateOption => {
          const reason = blockReason(t, now);
          return {
            id: t.uuid,
            name: t.templateName,
            language: t.language,
            category: (t.metaCategory ?? t.category).toUpperCase(),
            header: t.header,
            body: t.templateBody,
            footer: t.footer,
            buttons: buttonsOf(t.buttons).map((b) => b.text),
            slots: bodySlots(t.templateBody, t.variableMap),
            sendable: reason === null,
            reason,
          };
        });
      return { data, hasMore };
    });
  }

  /**
   * Turns a picked template and the agent's values into what the conversation core sends: the template's name and language, the values
   * by slot, and the body as the customer will read it (what the thread shows). A template is never refused by the 24 hour window.
   */
  private async templateContent(
    tx: Tx,
    orgId: number,
    uuid: string,
    input: Extract<SendMessageInput, { kind: 'template' }>,
  ): Promise<OutboundContent> {
    const template = await this.templates.findByUuid(tx, orgId, input.templateId);
    if (!template) {
      throw new AppError(
        ERROR_CODES.INBOX_TEMPLATE_NOT_SENDABLE,
        'That template was not found',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'templateId', message: 'not found' }],
      );
    }
    const wabaConfigId = await this.wabaConfigOf(tx, orgId, uuid);
    const refuse = (message: string): never => {
      throw new AppError(
        ERROR_CODES.INBOX_TEMPLATE_NOT_SENDABLE,
        message,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'templateId', message }],
      );
    };
    if (wabaConfigId === null)
      refuse('This conversation is not on a WhatsApp number that sends templates');
    if (template.providerConfigId !== wabaConfigId) {
      refuse('That template belongs to another WhatsApp number');
    }
    if (!isApproved(template)) refuse('That template is not approved');
    const reason = blockReason(template, new Date());
    if (reason)
      refuse(`That template cannot be sent from the inbox yet (${reason.replace(/_/g, ' ')})`);

    const slots = bodySlots(template.templateBody, template.variableMap);
    const problems = checkVariables(slots, input.variables);
    if (problems.length > 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'The template values are not valid',
        HttpStatus.UNPROCESSABLE_ENTITY,
        problems.map((p) => ({ path: `variables.${p.key}`, message: p.message })),
      );
    }
    const variables = cleanVariables(slots, input.variables);
    return {
      kind: 'template',
      name: template.templateName,
      language: template.language,
      variables,
      body: renderBody(template.templateBody, variables),
      templateId: template.id,
    };
  }

  /** The WhatsApp connection the conversation's channel runs on (null for a channel that is not WhatsApp Cloud). */
  private async wabaConfigOf(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const row = await this.repo.byUuid(tx, orgId, uuid);
    if (!row) throw conversationNotFound();
    const channel = await this.channels.findById(tx, orgId, row.channelId);
    return channel?.wabaConfigId ?? null;
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
