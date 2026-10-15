import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { ConversationsRepository } from './conversations.repository';
import { DeliveryReporter } from './delivery-reporter';
import { ChannelsRepository } from './channels.repository';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import { MessagesRepository } from './messages.repository';

export type ReceiptJob = {
  orgId: number;
  channelUuid: string;
  receipt: {
    providerMessageId: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    at: string;
    errorCode?: string;
    errorMessage?: string;
  };
};

export type ReceiptOutcome =
  /** The message moved to the reported status. */
  | 'applied'
  /** Recorded in the event log, but the status did not move (it was already at or past it: an out-of-order or repeated receipt). */
  | 'ignored'
  /** No message of this channel has that provider id (yet): the receipt is not ours, or it beat the send's commit. */
  | 'unknown'
  | 'channel_missing';

/**
 * Delivery receipts (plan-inbox-chat.md 3.4): a provider, or the simulator, reports a step for a message it knows only by the id it
 * gave us. The ledger turns that id into the message (and its partition), the status moves only forward
 * (queued < sent < delivered < read; `failed` only from queued or sent, never over a delivery) in one conditional UPDATE, and the
 * step is always appended to `message_events`, even when the summary column ignores it, so the history is complete when the
 * arrival order was not.
 *
 * Receipts are idempotent and order-free by construction: applying the same receipt twice, or `read` before `delivered`, ends in the
 * same state. A receipt for an id nobody has is `unknown`; whether that is worth retrying (it may have beaten the commit of the
 * send it reports on) is the queue processor's call, not a rule here.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly channelsRepo: ChannelsRepository,
    private readonly messages: MessagesRepository,
    private readonly realtime: ChatRealtimePublisher,
    private readonly conversations: ConversationsRepository,
    private readonly deliveries: DeliveryReporter,
  ) {}

  async apply(job: ReceiptJob): Promise<ReceiptOutcome> {
    const { orgId, receipt } = job;
    const at = new Date(receipt.at);

    const done = await this.db.txAs({ orgId }, async (tx) => {
      const channel = await this.channelsRepo.byUuid(tx, orgId, job.channelUuid);
      if (!channel) return 'channel_missing' as const;

      const entry = await this.messages.ledgerFind(
        tx,
        orgId,
        channel.id,
        'provider_id',
        receipt.providerMessageId,
      );
      if (!entry) return 'unknown' as const;

      const ref = { id: entry.messageId, createdAt: entry.messageCreatedAt };
      const outcome = await this.messages.applyReceipt(tx, orgId, ref, {
        status: receipt.status,
        at,
        errorCode: receipt.errorCode,
        errorMessage: receipt.errorMessage,
        providerMessageId: receipt.providerMessageId,
      });
      if (outcome === 'missing') return 'unknown' as const;

      await this.messages.insertEvent(tx, orgId, ref, receipt.status, {
        providerAt: receipt.at,
        applied: outcome === 'advanced',
        ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
        ...(receipt.errorMessage ? { errorMessage: receipt.errorMessage.slice(0, 500) } : {}),
      });
      const message =
        outcome === 'advanced' ? await this.messages.byId(tx, orgId, ref.id, ref.createdAt) : null;
      // Only a receipt that moved the message is news to the wallet; a late or repeated one reports nothing.
      if (outcome === 'advanced' && message) {
        const conv = await this.conversations.byId(tx, orgId, message.conversationId);
        if (conv)
          await this.deliveries.report(tx, orgId, {
            channelKind: channel.kind,
            conversationId: conv.id,
            peerKey: conv.peerKey,
            status: receipt.status,
            providerMessageId: receipt.providerMessageId,
            message,
          });
      }
      return { outcome, message };
    });

    if (done === 'channel_missing' || done === 'unknown') return done;
    if (done.outcome === 'advanced' && done.message) {
      await this.realtime.messageStatus(
        orgId,
        done.message.conversationUuid,
        done.message,
        receipt.status,
        at,
      );
      return 'applied';
    }
    return 'ignored';
  }
}
