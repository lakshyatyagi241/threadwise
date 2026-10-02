import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import type { ChannelRow } from './channels.repository';
import { ConversationsRepository, type ConversationRow } from './conversations.repository';

export const CONVERSATIONS_MODULE = 'conversations';

/**
 * The lifecycle moments of a thread the message pipelines cause, written in the pipeline's own transaction: a timeline event, the audit
 * row and the outbox event (`conversation.created`, `conversation.reopened`) that automations and notifications consume. Messages and
 * receipts are not lifecycle moments and never come through here (the outbox would drown in them).
 */
@Injectable()
export class ConversationLifecycleService {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async created(
    tx: Tx,
    orgId: number,
    channel: ChannelRow,
    conv: ConversationRow,
    actor: 'customer' | 'system' | 'user',
    actorUserId?: number | null,
  ): Promise<void> {
    await this.conversations.insertEvent(tx, orgId, conv.id, {
      type: 'created',
      actorType: actor === 'user' ? 'user' : 'system',
      actorUserId: actorUserId ?? null,
      payload: { channelUuid: channel.uuid, by: actor },
    });
    await this.audit.record(tx, {
      module: CONVERSATIONS_MODULE,
      recordId: conv.id,
      action: 'insert',
    });
    await this.outbox.emit(tx, {
      aggregateModule: CONVERSATIONS_MODULE,
      aggregateId: conv.id,
      eventType: 'conversation.created',
      payload: await this.payload(tx, orgId, channel, conv),
      orgId,
    });
  }

  /** A customer message brought a resolved, closed or snoozed thread back to open. */
  async reopened(
    tx: Tx,
    orgId: number,
    channel: ChannelRow,
    conv: ConversationRow,
    from: string,
  ): Promise<void> {
    await this.conversations.insertEvent(tx, orgId, conv.id, {
      type: 'reopened',
      actorType: 'system',
      payload: { from, by: 'customer' },
    });
    await this.outbox.emit(tx, {
      aggregateModule: CONVERSATIONS_MODULE,
      aggregateId: conv.id,
      eventType: 'conversation.reopened',
      payload: { ...(await this.payload(tx, orgId, channel, conv)), from },
      orgId,
    });
  }

  /** The first human answer the provider accepted: the SLA's first-response moment. */
  async firstResponse(
    tx: Tx,
    orgId: number,
    conv: ConversationRow,
    at: Date,
    userId: number | null,
  ): Promise<void> {
    await this.conversations.insertEvent(tx, orgId, conv.id, {
      type: 'first_response',
      actorType: userId === null ? 'system' : 'user',
      actorUserId: userId,
      payload: { at: at.toISOString() },
    });
  }

  private async payload(
    tx: Tx,
    orgId: number,
    channel: ChannelRow,
    conv: ConversationRow,
  ): Promise<Record<string, unknown>> {
    return {
      uuid: conv.uuid,
      channelUuid: channel.uuid,
      channelKind: channel.kind,
      contactUuid:
        conv.contactId === null
          ? null
          : await this.conversations.contactUuid(tx, orgId, conv.contactId),
      needsContact: conv.needsContact,
    };
  }
}
