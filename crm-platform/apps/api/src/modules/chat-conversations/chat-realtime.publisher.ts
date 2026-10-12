import { Injectable, Logger } from '@nestjs/common';
import { REALTIME_EVENT, type MessageStatus } from '@crm/contracts';
import { AudienceResolver, MemberDirectory, RealtimeEmitter } from '../../realtime';
import type { ConversationRow } from './conversations.repository';
import { toRealtimeMessage } from './message.mapper';
import type { MessageRow } from './messages.repository';

type ReceiptWire = Extract<MessageStatus, 'queued' | 'sent' | 'delivered' | 'read' | 'failed'>;

/**
 * What the message pipelines tell screens, AFTER their transaction committed (a rolled-back change is never announced), best
 * effort: the database is the truth and a client that misses an event catches up through its REST cursor. Nothing here throws.
 *
 * Who hears what (plan 3.6): a thread's new message and its ticks go to the people with that thread open (`conv:` room); a
 * list-level signal and the unread count go to the people who may see the conversation (`user:` rooms, from the audience
 * resolver at the moment of the emit, so a role change takes effect at once). Signals carry ids and versions, never a body.
 */
@Injectable()
export class ChatRealtimePublisher {
  private readonly logger = new Logger(ChatRealtimePublisher.name);

  constructor(
    private readonly emitter: RealtimeEmitter,
    private readonly audience: AudienceResolver,
    private readonly members: MemberDirectory,
  ) {}

  /**
   * A channel's status moved without a person asking (the provider stopped accepting its credentials): the people who manage channels
   * are told, so the inbox can show a reconnect warning. A signal with the reason; nobody else hears it.
   */
  async channelStatus(
    orgId: number,
    channelUuid: string,
    status: 'connected' | 'disconnected' | 'error' | 'needs_reauth',
    code: string | null,
    message: string | null,
  ): Promise<void> {
    await this.safely('channelStatus', async () => {
      const viewers = await this.members.viewers(orgId, 'inbox.channel.manage');
      await this.emitter.emitToUsers(
        orgId,
        viewers.filter((v) => v.scope !== null).map((v) => v.userId),
        REALTIME_EVENT.channelStatus,
        { channelId: channelUuid, status, code, message },
      );
    });
  }

  /** A message was stored on the thread: it goes to the open thread, and the list row is told to refetch. */
  async messageStored(
    orgId: number,
    conv: ConversationRow,
    message: MessageRow,
    changed: string[],
    opts: { unread?: boolean } = {},
  ): Promise<void> {
    await this.safely('messageStored', async () => {
      await this.emitter.emit(orgId, [{ kind: 'conv', id: conv.uuid }], REALTIME_EVENT.messageNew, {
        conversationId: conv.uuid,
        message: toRealtimeMessage(message),
      });
      await this.list(orgId, conv, changed, opts);
    });
  }

  /**
   * A stored message changed in place (an inbound file finished downloading, or failed): the thread gets the message again, and a client
   * that sees a message it already has refetches it, because the event never carries the file's link (it is minted per reader).
   */
  async messageUpdated(
    orgId: number,
    conv: ConversationRow,
    message: MessageRow,
    changed: string[],
  ): Promise<void> {
    await this.safely('messageUpdated', async () => {
      await this.emitter.emit(orgId, [{ kind: 'conv', id: conv.uuid }], REALTIME_EVENT.messageNew, {
        conversationId: conv.uuid,
        message: toRealtimeMessage(message),
      });
      await this.list(orgId, conv, changed, {});
    });
  }

  /** A conversation row changed in a way a list must refetch for (and, optionally, its unread count moved). */
  async conversationChanged(
    orgId: number,
    conv: ConversationRow,
    changed: string[],
    opts: { unread?: boolean } = {},
  ): Promise<void> {
    await this.safely('conversationChanged', () => this.list(orgId, conv, changed, opts));
  }

  /** A tick: the message's status moved (or it failed). */
  async messageStatus(
    orgId: number,
    conversationUuid: string,
    message: Pick<MessageRow, 'uuid' | 'clientMessageId'>,
    status: ReceiptWire,
    at: Date,
  ): Promise<void> {
    await this.safely('messageStatus', async () => {
      await this.emitter.emit(
        orgId,
        [{ kind: 'conv', id: conversationUuid }],
        REALTIME_EVENT.messageStatus,
        {
          conversationId: conversationUuid,
          messageId: message.uuid,
          clientMessageId: message.clientMessageId,
          status,
          at: at.toISOString(),
        },
      );
    });
  }

  /** Something on the open thread changed that a signal cannot describe (an inbound reaction): fetch the thread again. */
  async threadChanged(orgId: number, conversationUuid: string, reason: string): Promise<void> {
    await this.safely('threadChanged', async () => {
      await this.emitter.requestResync(orgId, [{ kind: 'conv', id: conversationUuid }], reason);
    });
  }

  private async list(
    orgId: number,
    conv: ConversationRow,
    changed: string[],
    opts: { unread?: boolean },
  ): Promise<void> {
    const people = await this.audience.forConversation(orgId, {
      assigneeUserId: conv.assigneeUserId,
      assigneeTeamId: conv.assigneeTeamId,
      channelOwnerUserId: conv.channelOwnerUserId,
    });
    await this.emitter.emitToUsers(orgId, people, REALTIME_EVENT.conversationUpsert, {
      conversationId: conv.uuid,
      rowVersion: conv.rowVersion,
      changed,
    });
    if (opts.unread) {
      await this.emitter.emitToUsers(orgId, people, REALTIME_EVENT.unread, {
        conversationId: conv.uuid,
        unread: conv.unreadCount,
      });
    }
  }

  private async safely(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn({ err, what }, 'realtime publish failed');
    }
  }
}
