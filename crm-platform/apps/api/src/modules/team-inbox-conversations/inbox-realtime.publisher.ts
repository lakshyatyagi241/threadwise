import { Injectable, Logger } from '@nestjs/common';
import { REALTIME_EVENT } from '@crm/contracts';
import { AudienceResolver, RealtimeEmitter, type ConversationRecord } from '../../realtime';

/**
 * What the inbox tells open screens after a change commits. Everything here is a signal (an id, a version, what changed): the client
 * refetches the row through REST, where the caller's scope and row-level security apply. Never called inside a transaction (a change
 * that rolled back must not be announced), and never throws: the database is the truth and a client that missed a signal resyncs.
 */
@Injectable()
export class InboxRealtimePublisher {
  private readonly logger = new Logger(InboxRealtimePublisher.name);

  constructor(
    private readonly audience: AudienceResolver,
    private readonly emitter: RealtimeEmitter,
  ) {}

  /** `inbox.conversation.upsert` to everyone who may see the conversation, plus `alsoUserIds` (people who just lost it: their list drops the row). */
  async conversationChanged(
    orgId: number,
    conversation: { uuid: string; rowVersion: number } & ConversationRecord,
    changed: string[],
    opts: { alsoUserIds?: number[]; excludeUserIds?: number[] } = {},
  ): Promise<void> {
    try {
      const users = await this.audience.forConversation(orgId, conversation, opts);
      await this.emitter.emitToUsers(orgId, users, REALTIME_EVENT.conversationUpsert, {
        conversationId: conversation.uuid,
        rowVersion: conversation.rowVersion,
        changed,
      });
    } catch (err) {
      this.logger.warn({ err, orgId }, 'could not publish a conversation change');
    }
  }
}
