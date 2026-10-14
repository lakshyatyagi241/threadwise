import { Injectable } from '@nestjs/common';
import { MESSAGE_RECEIVED_EVENT, NOTIFICATION_PREVIEW_MAX } from '@crm/contracts';
import type { MessageReceivedPayload } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { notifyConfig } from '../../config/domains/notifications.env';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import type { ChannelRow } from './channels.repository';
import { ConversationsRepository, type ConversationRow } from './conversations.repository';
import { isPhoneChannel } from './peer-key';

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
    opts: { quiet?: boolean } = {},
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
    // Imported history is quiet: a thread recreated from the past is not "a new conversation" to any automation or webhook.
    if (opts.quiet) return;
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

  /**
   * A customer's message was stored: the one per-message outbox event, read by the conversation notifications (BL-096). Written in the
   * ingest transaction, so a message that committed always has its event and a rolled-back one has none. The event carries ids and an
   * 80-character preview, never the body. Skipped (nothing written) while `NOTIFY_CONVERSATIONS_ENABLED` is off, so the outbox does not
   * grow with events nobody reads.
   *
   * This is the exception to "messages never come through here": it is one small row per inbound message (no receipts, no outbound), and
   * the notification must not be lost if the process dies between the commit and a direct call.
   */
  async messageReceived(
    tx: Tx,
    orgId: number,
    channel: ChannelRow,
    conv: ConversationRow,
    message: { uuid: string; preview: string | null },
    facts: { firstInbound: boolean; group: boolean; at: string },
  ): Promise<void> {
    if (!notifyConfig().conversationsEnabled) return;
    const payload: MessageReceivedPayload = {
      conversationId: conv.uuid,
      messageId: message.uuid,
      channelId: channel.uuid,
      channelKind: channel.kind,
      firstInbound: facts.firstInbound,
      group: facts.group,
      preview: (message.preview ?? '').slice(0, NOTIFICATION_PREVIEW_MAX),
      contactName: notificationNameOf(channel.kind, conv, facts.group),
      at: facts.at,
    };
    await this.outbox.emit(tx, {
      aggregateModule: CONVERSATIONS_MODULE,
      aggregateId: conv.id,
      eventType: MESSAGE_RECEIVED_EVENT,
      payload: { ...payload },
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

/**
 * What a notification calls the sender: the sender's own name; a group's title; else, for a phone channel, the last four digits
 * (decision D4: a bare number is not put in a notification); else null and the client falls back to the channel's name.
 */
export function notificationNameOf(
  channelKind: string,
  conv: Pick<ConversationRow, 'peerName' | 'peerKey' | 'title'>,
  group: boolean,
): string | null {
  if (group) return conv.title.trim() || null;
  const name = conv.peerName?.trim();
  if (name) return name.slice(0, 200);
  return isPhoneChannel(channelKind) ? `…${conv.peerKey.slice(-4)}` : null;
}
