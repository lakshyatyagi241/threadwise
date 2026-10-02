import { Injectable } from '@nestjs/common';
import type { ConversationEventListResponse, ListConversationEventsQuery } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { ConversationEventsRepository } from './conversation-events.repository';
import { ConversationsRepository } from './conversations.repository';
import { InboxAccess, conversationNotFound } from './inbox-access.service';

/** The activity timeline of a conversation (WD-TIB1-013), newest first. Readable by anyone who can open the conversation. */
@Injectable()
export class InboxTimelineService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConversationsRepository,
    private readonly events: ConversationEventsRepository,
    private readonly access: InboxAccess,
  ) {}

  async list(
    uuid: string,
    query: ListConversationEventsQuery,
  ): Promise<ConversationEventListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      const record = await this.repo.recordByUuid(tx, ctx.orgId, uuid);
      if (!record) throw conversationNotFound();
      this.access.assertVisible(viewer, record);
      return this.events.list(tx, ctx.orgId, { id: record.id, uuid }, query);
    });
  }
}
