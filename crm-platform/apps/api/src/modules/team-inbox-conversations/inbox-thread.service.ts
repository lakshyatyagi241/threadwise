import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  INBOX_TEMPLATE_LIST_MAX,
  type EmailReplyExtras,
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
import { EmailTemplatesReader } from '../email-templates';
import {
  BUILDABLE_TYPES,
  TemplatesRepository,
  TemplatesService,
  metaEditBlockOf,
} from '../message-templates';
import { ConversationsRepository } from './conversations.repository';
import { InboxAccess, PERM, conversationNotFound } from './inbox-access.service';
import {
  blockReason,
  bodySlots,
  buttonsOf,
  checkVariables,
  cleanVariables,
  hasBlankCopyCode,
  isApproved,
  renderBody,
  sendComponentsOf,
  templatePreviewOf,
  matchTemplateByBody,
  previewButtonsOf,
  type MatchCandidate,
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
  private readonly logger = new Logger(InboxThreadService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConversationsRepository,
    private readonly access: InboxAccess,
    private readonly uploads: MediaUploadsRepository,
    private readonly channels: ChannelsFacade,
    private readonly templates: TemplatesRepository,
    private readonly emailTemplates: EmailTemplatesReader,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
    private readonly templateService: TemplatesService,
  ) {}

  /** The conversation for a contact on a channel, created if missing. The route requires `inbox.conversation.reply`, like sending the first message. */
  async open(contactId: string, channelId: string): Promise<{ id: string }> {
    const ref = await this.conversations.openConversationFor(contactId, channelId);
    return { id: ref.id };
  }

  async listMessages(uuid: string, query: ListMessagesQuery): Promise<MessageListResponse> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      const record = await this.repo.recordByUuid(tx, ctx.orgId, uuid);
      if (!record) throw conversationNotFound();
      this.access.assertVisible(viewer, record);
    });
    const page = await this.conversations.listMessages(uuid, query);
    return {
      ...page,
      data: await this.withMatchedTemplates(await this.withTemplatePreviews(page.data)),
    };
  }

  /**
   * Draws the template messages of a page: the header, footer and buttons come from the stored template, resolved for the whole page in
   * ONE tenant-scoped query. A template deleted since leaves the message without a preview, and the bubble falls back to the body the
   * thread stored at send time.
   */
  private async withTemplatePreviews(messages: MessageResponse[]): Promise<MessageResponse[]> {
    const ids = [
      ...new Set(
        messages.flatMap((m) =>
          m.kind === 'template' && m.template?.templateId ? [m.template.templateId] : [],
        ),
      ),
    ];
    if (ids.length === 0) return messages;
    const orgId = RequestContextStore.orgId();
    const rows = await this.db.tx((tx) => this.templates.findManyByUuids(tx, orgId, ids));
    // A fresh link to each template's header file (its stored copy or the channel's sample), made at each read like the template detail's.
    // A link that cannot be made costs its bubble the media only: the page still loads, with the marker.
    const linkOf = await this.templateService.previewLinker();
    const byUuid = new Map(
      await Promise.all(
        rows.map(async (r) => {
          const file = await linkOf(r).catch((err: unknown) => {
            this.logger.warn(`header link for template ${r.uuid} not made: ${String(err)}`);
            return null;
          });
          return [r.uuid, templatePreviewOf(r, file)] as const;
        }),
      ),
    );
    return messages.map((m) => {
      const preview = m.template?.templateId ? byUuid.get(m.template.templateId) : undefined;
      return preview && m.template ? { ...m, template: { ...m.template, preview } } : m;
    });
  }

  /**
   * A message the business sent that is not stored as a template message (an imported history, a copy of what it sent from its phone)
   * keeps no link to its template, so it showed no buttons while the same template sent from here did. When its words are exactly one
   * approved template's body, the thread gets that template's buttons (`matchedTemplate`). One query for the page, and none when the
   * page has no such message.
   */
  private async withMatchedTemplates(messages: MessageResponse[]): Promise<MessageResponse[]> {
    const loose = messages.filter(
      (m) =>
        m.direction === 'out' &&
        m.kind !== 'template' &&
        m.template === null &&
        (m.body ?? '').trim() !== '' &&
        (m.kind === 'text' || m.kind === 'image' || m.kind === 'video' || m.kind === 'document'),
    );
    if (loose.length === 0) return messages;
    const orgId = RequestContextStore.orgId();
    const rows = await this.db.tx((tx) =>
      this.templates.list(tx, orgId, { limit: 300, statusGroup: 'approved' }),
    );
    const candidates: MatchCandidate[] = rows
      .map((r) => ({
        name: r.templateName,
        body: r.templateBody,
        header: r.header,
        buttons: previewButtonsOf(r.buttons),
      }))
      .filter((c) => c.buttons.length > 0);
    if (candidates.length === 0) return messages;
    const looseIds = new Set(loose.map((m) => m.id));
    return messages.map((m) => {
      if (!looseIds.has(m.id)) return m;
      const hit = matchTemplateByBody(m.body, candidates);
      return hit ? { ...m, matchedTemplate: { name: hit.name, buttons: hit.buttons } } : m;
    });
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
      if (input.kind === 'text') {
        // A reply from a marketing email template is marketing mail: the server decides, so the client cannot send it without the
        // ConsentGate and the unsubscribe link. A template the sender cannot use (or an archived one) refuses the reply.
        let email: (EmailReplyExtras & { marketing?: boolean }) | undefined = input.email;
        if (email?.templateId) {
          const purpose = await this.emailTemplates.purposeForReply(
            tx,
            ctx.orgId,
            ctx.userId!,
            email.templateId,
          );
          if (purpose === 'marketing') email = { ...email, marketing: true };
        }
        return {
          kind: 'text',
          body: input.body,
          ...(email ? { email } : {}),
          ...(input.mentions?.length ? { mentions: input.mentions } : {}),
        };
      }
      if (input.kind === 'reaction') return { kind: 'reaction', emoji: input.emoji };
      if (input.kind === 'location') {
        const { latitude, longitude, name, address } = input;
        return { kind: 'location', latitude, longitude, name, address };
      }
      if (input.kind === 'contacts') return { kind: 'contacts', contacts: input.contacts };
      if (input.kind === 'interactive') {
        const i = input.interactive;
        if (i.type === 'buttons') {
          return {
            kind: 'interactive',
            interactive: {
              ...i,
              buttons: i.buttons.map((b, n) => ({ id: `btn-${n + 1}`, title: b.title })),
            },
          };
        }
        if (i.type === 'list') {
          let n = 0;
          return {
            kind: 'interactive',
            interactive: {
              ...i,
              sections: i.sections.map((sec) => ({
                ...sec,
                rows: sec.rows.map((r) => ({ ...r, id: `row-${++n}` })),
              })),
            },
          };
        }
        return { kind: 'interactive', interactive: i };
      }
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
        replyToMessageId:
          input.kind === 'reaction' ? input.targetMessageId : input.replyToMessageId,
        // Only the kinds that take `origin` (text, media, template) can come from a contact's drawer.
        origin:
          input.kind === 'text' || input.kind === 'media' || input.kind === 'template'
            ? input.origin
            : undefined,
      });
      return (await this.withTemplatePreviews([message]))[0]!;
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
   * The approved templates of the workspace, for the picker (the inbox's and the contact's send drawer). A template of ANOTHER WhatsApp
   * number is left out: it can never be sent from this conversation, and nobody edits another number's template from here. When the
   * channel is not linked to a number every template is listed with that reason, disabled; one the inbox cannot fill in is listed with
   * its reason too. A template that is not approved is left out.
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
      // The page is shared with other numbers' templates, so this conversation's own come first: they are never pushed off the page.
      // `list` returns one row beyond the limit when there are more: that row is how `hasMore` is known, and it is not sent.
      const rows = await this.templates.list(tx, ctx.orgId, {
        limit: INBOX_TEMPLATE_LIST_MAX,
        status: 'approved',
        ...(wabaConfigId === null ? {} : { preferProviderConfigId: wabaConfigId }),
        ...(query.q ? { q: query.q } : {}),
      });
      // Filtered before the page is cut, so a row dropped by `isApproved` never leaves a short page that says there is more.
      const approved = rows.filter(
        (t) => isApproved(t) && (wabaConfigId === null || t.providerConfigId === wabaConfigId),
      );
      const hasMore = approved.length > INBOX_TEMPLATE_LIST_MAX;
      const data = approved.slice(0, INBOX_TEMPLATE_LIST_MAX).map((t): InboxTemplateOption => {
        // The same refusals as the send (`templateContent`), checked first so the picker names the real reason.
        const reason = wabaConfigId === null ? 'not_linked' : blockReason(t, now);
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
          editable: BUILDABLE_TYPES.has(t.templateType) && metaEditBlockOf(t, now) === null,
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
    if (hasBlankCopyCode(template.buttons))
      refuse('That template has a copy-code button with no code');

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
      components: sendComponentsOf(template, variables),
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
    const components = await this.db.tx(async (tx) => {
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
      this.assertNotResolved(record);
      this.access.assertNotAssignedToOther(ctx, record);
      return this.rebuiltComponentsOf(tx, ctx.orgId, messageUuid);
    });
    return (
      await this.withTemplatePreviews([
        await this.conversations.retryOutbound(messageUuid, components),
      ])
    )[0]!;
  }

  /**
   * A template message sent before its Cloud API components were stored carries only its values, so a Retry would send the body without
   * the copy-code parameter again. Its components are built now, from the template and the values it sent. Undefined when the message
   * already has them or its template is gone; a template whose copy-code button has no code is refused, as a send is.
   */
  private async rebuiltComponentsOf(
    tx: Tx,
    orgId: number,
    messageUuid: string,
  ): Promise<Record<string, unknown>[] | undefined> {
    const sent = await this.repo.templateSendOf(tx, orgId, messageUuid);
    if (!sent || sent.hasComponents || sent.templateId === null) return undefined;
    const template = await this.templates.findById(tx, orgId, sent.templateId);
    if (!template) return undefined;
    if (hasBlankCopyCode(template.buttons)) {
      throw new AppError(
        ERROR_CODES.INBOX_TEMPLATE_NOT_SENDABLE,
        'That template has a copy-code button with no code',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'templateId', message: 'That template has a copy-code button with no code' }],
      );
    }
    return sendComponentsOf(template, sent.variables);
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
    this.assertNotResolved(record);
    this.access.assertNotAssignedToOther(ctx, record);
  }

  /** A resolved or closed thread takes no agent message (text, media, template, share, reaction, retry): reopen it first. */
  private assertNotResolved(record: { status: string }): void {
    if (record.status === 'resolved' || record.status === 'closed') {
      throw new AppError(
        ERROR_CODES.CONVERSATION_RESOLVED,
        'This conversation is resolved. Reopen it to reply.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }
}
