import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { ChannelError, type ChannelRuntime } from '../../infra/providers/chat-conversations';
import { ChannelDispatcher, type DispatchResult } from './channel-dispatcher.service';
import { ChannelRegistryService } from './channel-registry.service';
import { ChannelsRepository } from './channels.repository';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import { ConversationLifecycleService } from './conversation-lifecycle.service';
import { ConversationsRepository, type ConversationRow } from './conversations.repository';
import { failureReason } from './message-rules';
import { MessagesRepository, type MessageRow } from './messages.repository';
import { envelopeOf } from './outbound-envelope';

export type DispatchOutcome =
  | 'sent'
  /** The message is not `queued` any more (already sent, failed, or its send was done by an earlier attempt): nothing to do. */
  | 'skipped'
  | 'missing'
  /** Ended `failed` (a permanent refusal, a guard, or the last retry): the agent sees a Retry. */
  | 'failed';

export const IN_FLIGHT = 'DISPATCH_IN_FLIGHT';

export interface DispatchOptions {
  /** 1 on the first attempt of this dispatch. Reaches the adapter (a simulated fault may depend on it) and the event log. */
  attempt: number;
  /** The queue will not try again after this attempt: a retryable error ends the message `failed` instead of being rethrown. */
  finalAttempt: boolean;
}

/**
 * The send worker's work for one outbound message (plan-inbox-chat.md 3.4): re-read the message, send it through the dispatcher
 * (guards: connected channel, window, emergency halt, content screen; one adapter call per client reference), and record the outcome.
 *
 * Kill-safe, because the message row exists before the job does and this code never creates one: a worker killed at any point leaves
 * the message `queued`, the job is retried (BullMQ's stalled-job recovery, or the recovery sweep), and the retry
 *
 *   - finds the message already sent and does nothing, or
 *   - finds it queued and asks the dispatcher again, which returns the stored answer if the provider had accepted the first time
 *     (the answer is kept 24 hours under the client reference) and calls the provider only if it had not.
 *
 * The one window it cannot close is the provider accepting a message and the process dying before that answer is stored: the Cloud
 * API has no idempotency key, so that retry can send once more (plan 3.4, documented). Each attempt is written to `message_events`
 * BEFORE the provider is called, so the log shows the attempt that has no recorded outcome.
 *
 * Outcomes: success moves `queued -> sent` and stores the provider id in the ledger (receipts find the message through it) in one
 * transaction with the thread's `last_outbound_at`, the end of the customer's wait and, for a staff reply, the first response. A
 * refusal that a retry cannot fix (`ChannelError` not retryable, or a guard's `AppError`: halt, blocked content, window closed,
 * channel switched off) ends the message `failed`; a retryable error is rethrown to the queue, and on its last attempt ends `failed`.
 * First response is stamped only here, on acceptance: WaDesk stamped it when the agent pressed send, even if the send then failed.
 */
@Injectable()
export class MessageDispatchService {
  private readonly logger = new Logger(MessageDispatchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly channelsRepo: ChannelsRepository,
    private readonly channels: ChannelRegistryService,
    private readonly dispatcher: ChannelDispatcher,
    private readonly lifecycle: ConversationLifecycleService,
    private readonly realtime: ChatRealtimePublisher,
  ) {}

  async dispatch(
    orgId: number,
    messageUuid: string,
    options: DispatchOptions,
  ): Promise<DispatchOutcome> {
    const prepared = await this.prepare(orgId, messageUuid, options.attempt);
    if (prepared === 'missing' || prepared === 'skipped') return prepared;
    const { row, conv, runtime, envelope } = prepared;
    const ref = { id: row.id, createdAt: row.createdAtText };

    let sent: DispatchResult;
    try {
      sent = await this.dispatcher.send({
        channel: runtime,
        envelope,
        lastInboundAt: conv.lastInboundAt,
        source: 'inbox',
      });
    } catch (err) {
      return this.failed(orgId, row, ref, err, options);
    }

    await this.markSent(orgId, row, conv, ref, sent);
    // After the commit: a receipt finds its message through the ledger row this transaction wrote.
    await this.dispatcher.scheduleReceipts(runtime, sent);
    return 'sent';
  }

  // --- stages --------------------------------------------------------------------------------------------------------------------

  private async prepare(
    orgId: number,
    messageUuid: string,
    attempt: number,
  ): Promise<
    | 'missing'
    | 'skipped'
    | { row: MessageRow; conv: ConversationRow; runtime: ChannelRuntime; envelope: unknown }
  > {
    return this.db.txAs({ orgId }, async (tx) => {
      const row = await this.messages.byUuid(tx, orgId, messageUuid);
      if (!row || row.direction !== 'out') return 'missing' as const;
      if (row.status !== 'queued') return 'skipped' as const;

      const conv = (await this.conversations.byId(tx, orgId, row.conversationId))!;
      const channel = (await this.channelsRepo.byId(tx, orgId, conv.channelId))!;
      const runtime = await this.channels.runtime(tx, orgId, channel);
      const replyTo = row.replyToMessageUuid
        ? await this.messages.byUuid(tx, orgId, row.replyToMessageUuid)
        : null;
      const envelope = envelopeOf(row, conv.peerKey, replyTo?.providerMessageId ?? null, attempt);
      // Before the provider is called: the log must show an attempt even if the process dies inside the call.
      await this.messages.insertEvent(
        tx,
        orgId,
        { id: row.id, createdAt: row.createdAtText },
        'attempt',
        {
          attempt,
        },
      );
      return { row, conv, runtime, envelope };
    });
  }

  private async markSent(
    orgId: number,
    row: MessageRow,
    conv: ConversationRow,
    ref: { id: number; createdAt: string },
    sent: DispatchResult,
  ): Promise<void> {
    const done = await this.db.txAs({ orgId }, async (tx) => {
      // The thread's lock first (the order every writer takes), then the message.
      const lockedConv = (await this.conversations.byId(tx, orgId, conv.id, true))!;
      const moved = await this.messages.markSent(tx, orgId, ref, {
        providerMessageId: sent.providerMessageId,
        acceptedAt: sent.acceptedAt,
      });
      // Idempotent: a retried attempt that finds the message already sent changes nothing.
      if (!moved) return null;

      await this.messages.ledgerInsert(
        tx,
        orgId,
        lockedConv.channelId,
        'provider_id',
        sent.providerMessageId,
        {
          messageId: ref.id,
          messageCreatedAt: ref.createdAt,
          conversationId: conv.id,
        },
      );
      await this.messages.insertEvent(tx, orgId, ref, 'sent', {
        providerMessageId: sent.providerMessageId,
        acceptedAt: sent.acceptedAt.toISOString(),
        replayed: sent.replayed,
      });
      const humanReply = row.senderKind === 'agent';
      const { row: after, firstResponse } = await this.conversations.applyOutboundSent(
        tx,
        orgId,
        conv.id,
        {
          at: sent.acceptedAt,
          humanReply,
        },
      );
      if (firstResponse) {
        await this.lifecycle.firstResponse(tx, orgId, after, sent.acceptedAt, row.senderUserId);
      }
      await this.conversations.touchChannel(tx, orgId, lockedConv.channelId);
      const message = (await this.messages.byId(tx, orgId, ref.id, ref.createdAt))!;
      return { after, message, firstResponse };
    });
    if (!done) return;

    await this.realtime.messageStatus(
      orgId,
      done.message.conversationUuid,
      done.message,
      'sent',
      sent.acceptedAt,
    );
    const changed = ['lastOutbound', 'waiting'];
    if (done.firstResponse) changed.push('firstResponse');
    await this.realtime.conversationChanged(orgId, done.after, changed);
  }

  /**
   * What a failed send means. A permanent refusal (or a guard) ends the message; a retryable error goes back to the queue, unless
   * this was the last attempt. `DISPATCH_IN_FLIGHT` (another worker holds this message) is never a failure and never counts: the
   * processor puts the job back for later.
   */
  private async failed(
    orgId: number,
    row: MessageRow,
    ref: { id: number; createdAt: string },
    err: unknown,
    options: DispatchOptions,
  ): Promise<DispatchOutcome> {
    const classified = classify(err);
    if (classified.code === IN_FLIGHT) throw err;

    if (classified.retryable && !options.finalAttempt) {
      await this.db.txAs({ orgId }, (tx) =>
        this.messages.insertEvent(tx, orgId, ref, 'retry', {
          attempt: options.attempt,
          code: classified.code,
          reason: classified.reason,
        }),
      );
      throw err;
    }

    const failure = {
      code: classified.code,
      reason: classified.retryable
        ? `${classified.reason} (gave up after ${options.attempt} attempts)`
        : classified.reason,
    };
    const done = await this.db.txAs({ orgId }, async (tx) => {
      const moved = await this.messages.markFailed(tx, orgId, ref, failure);
      if (!moved) return null;
      await this.messages.insertEvent(tx, orgId, ref, 'failed', {
        ...failure,
        attempt: options.attempt,
      });
      return this.messages.byId(tx, orgId, ref.id, ref.createdAt);
    });
    if (done) {
      this.logger.log({ orgId, message: row.uuid, code: failure.code }, 'outbound message failed');
      await this.realtime.messageStatus(orgId, done.conversationUuid, done, 'failed', new Date());
    }
    return 'failed';
  }
}

function classify(err: unknown): { code: string; reason: string; retryable: boolean } {
  if (err instanceof ChannelError) {
    return { code: err.code, reason: failureReason(err.message), retryable: err.retryable };
  }
  // A guard or a rule (emergency halt, blocked content, window closed, channel switched off): a retry cannot fix it until a person
  // changes something, and then they use Retry.
  if (err instanceof AppError) {
    return { code: err.code, reason: failureReason(err.message), retryable: false };
  }
  // The database, the network, anything unclassified: try again.
  return {
    code: 'DISPATCH_ERROR',
    reason: failureReason((err as Error)?.message ?? 'Send failed'),
    retryable: true,
  };
}
