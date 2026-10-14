import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type EmailTemplateRenderResponse,
  type RenderEmailTemplateInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { MergeTagService } from '../../crm';
import { EmailTemplatesService } from '../../email-templates';
import { ConversationsRepository } from '../conversations.repository';
import { InboxAccess, PERM, conversationNotFound } from '../inbox-access.service';

/**
 * "Use this email template in the conversation I have open": the template with its variables filled in from the conversation's contact,
 * the agent and the workspace. Sends nothing and counts nothing (the use is counted when the reply is sent). The caller needs the right to
 * reply to THAT conversation (one they cannot see is a 404), and the conversation must be an email thread (422 otherwise).
 */
@Injectable()
export class InboxEmailTemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly conversations: ConversationsRepository,
    private readonly access: InboxAccess,
    private readonly templates: EmailTemplatesService,
    private readonly mergeTags: MergeTagService,
  ) {}

  async render(
    uuid: string,
    input: RenderEmailTemplateInput,
  ): Promise<EmailTemplateRenderResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      const record = await this.conversations.recordByUuid(tx, ctx.orgId, input.conversationId);
      if (!record) throw conversationNotFound();
      this.access.assertVisible(viewer, record);
      await this.access.assertCan(tx, ctx, PERM.reply, record);
      const convo = await this.conversations.byUuid(tx, ctx.orgId, input.conversationId);
      if (!convo) throw conversationNotFound();
      if (convo.channelKind !== 'email') {
        throw new AppError(
          ERROR_CODES.CHANNEL_CAPABILITY_UNSUPPORTED,
          'Email templates can only be used in an email conversation.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'conversationId', message: `Not an email conversation (${convo.channelKind})` }],
        );
      }
      const base = await this.mergeTags.baseContext(tx, ctx.orgId);
      const contact =
        convo.contactId !== null
          ? await this.mergeTags.contactFor(tx, ctx.orgId, convo.contactId)
          : undefined;
      const result = await this.templates.renderFor(tx, ctx, uuid, {
        contact,
        base,
        peerName: convo.peerName,
      });
      return contact ? result : { ...result, source: 'sample' as const };
    });
  }
}
