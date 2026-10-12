import { Injectable } from '@nestjs/common';
import { emailMetaSchema, type EmailMeta } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { MemberDirectory, PERM_CONVERSATION_READ, conversationVisible } from '../../realtime';
import { ConversationsRepository } from './conversations.repository';
import { MessagesRepository } from './messages.repository';

/** What the email module needs to serve a message's attachment: the parsed block and where the message lives. */
export interface EmailMessageRef {
  email: EmailMeta;
  conversationId: number;
  conversationUuid: string;
  channelId: number;
  messageId: number;
  messageUuid: string;
  /** The row time as text (the partition key), for the module's own lookups. */
  messageCreatedAt: string;
}

/**
 * The seam the email module reads a message's `meta.email` through (attachment download, `GET /v2/email/attachments/...`): the
 * message must belong to the named conversation and the actor must be allowed to see that conversation, by the same rule as the list,
 * the thread and the socket (`conversationVisible`, permission `inbox.conversation.read`). Every refusal answers `null` (the caller
 * answers 404): a message the actor may not see is not confirmed to exist.
 */
@Injectable()
export class EmailMessageAccess {
  constructor(
    private readonly db: DatabaseService,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly directory: MemberDirectory,
  ) {}

  /** Defaults to the caller of the current request. */
  async readable(
    conversationUuid: string,
    messageUuid: string,
    actor?: { orgId: number; userId: number },
  ): Promise<EmailMessageRef | null> {
    const who = actor ?? this.fromContext();
    if (!who) return null;
    const found = await this.db.txAs({ orgId: who.orgId, userId: who.userId }, async (tx) => {
      const row = await this.messages.byUuid(tx, who.orgId, messageUuid);
      if (!row || row.conversationUuid !== conversationUuid) return null;
      const conv = await this.conversations.byId(tx, who.orgId, row.conversationId);
      if (!conv) return null;
      return { row, conv };
    });
    if (!found) return null;
    const parsed = emailMetaSchema.safeParse(found.row.meta.email);
    if (!parsed.success) return null;
    const viewer = await this.directory.viewer(who.orgId, who.userId, PERM_CONVERSATION_READ);
    if (!conversationVisible(viewer, found.conv)) return null;
    return {
      email: parsed.data,
      conversationId: found.conv.id,
      conversationUuid: found.conv.uuid,
      channelId: found.conv.channelId,
      messageId: found.row.id,
      messageUuid: found.row.uuid,
      messageCreatedAt: found.row.createdAtText,
    };
  }

  private fromContext(): { orgId: number; userId: number } | null {
    const ctx = RequestContextStore.require();
    return ctx.userId ? { orgId: ctx.orgId, userId: ctx.userId } : null;
  }
}
