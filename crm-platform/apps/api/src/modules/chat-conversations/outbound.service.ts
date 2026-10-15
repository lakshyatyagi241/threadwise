import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, type MessageResponse } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import type { ChannelRuntime } from '../../infra/providers/chat-conversations';
import {
  groupIdOf,
  isGroupPeer,
  personalGroupSendBlock,
} from '../../infra/providers/whatsapp/group-peer';
import { QUEUES } from '../../infra/queue/queues';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { WalletGateService } from '../wallet-message-billing';
import { ChannelDispatcher } from './channel-dispatcher.service';
import { ChannelRegistryService } from './channel-registry.service';
import { ChannelsRepository } from './channels.repository';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import type { EnqueueOutboundInput, EnqueueOutboundResult } from './conversations.facade';
import { ConversationsRepository, type ConversationRow } from './conversations.repository';
import {
  MESSAGE_SEND_JOB,
  MESSAGE_SEND_JOB_OPTIONS,
  messageSendJobId,
  type MessageSendJob,
} from './message-dispatch.job';
import { previewOf } from './message-rules';
import { MessageViewService } from './message-view.service';
import { MessagesRepository, type MessageRow } from './messages.repository';
import { envelopeOf, messageFieldsOf } from './outbound-envelope';

/** What a person can react to: a message the customer's app shows (not a note-like system line, not another reaction). */
const REACTABLE: ReadonlySet<string> = new Set([
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'contact',
  'template',
  'interactive',
]);

export const conversationNotFound = (uuid: string): AppError =>
  new AppError(
    ERROR_CODES.CONVERSATION_NOT_FOUND,
    `Conversation ${uuid} not found`,
    HttpStatus.NOT_FOUND,
  );

const startOfUtcMonth = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * Sending, from the agent's side (plan-inbox-chat.md 3.4, "Outbound"): validate and store a `queued` message, hand it to the dispatch
 * worker, answer at once. Nothing is sent from here.
 *
 * Everything that can be known before sending is checked here, so the agent sees the reason right away and no row is created just to
 * fail: the channel is connected and can carry this kind of message, the 24 hour window is open for a free-form message, and the plan's
 * monthly cap has room (`ChannelDispatcher.assertCanQueue`). The emergency halt and content screen are the worker's, at send time.
 *
 * One transaction holds the thread's row lock, the client-id ledger row (a repeated `clientMessageId` returns the first message and
 * sends once), the next `seq`, the message and its `queued` event. The job is enqueued after the commit; a message whose enqueue was
 * lost (a crash between the two, Redis down) is picked up by the recovery sweep, which is why the enqueue failing is not an error.
 */
@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly channelsRepo: ChannelsRepository,
    private readonly channels: ChannelRegistryService,
    private readonly dispatcher: ChannelDispatcher,
    private readonly plans: PlanEntitlementService,
    private readonly wallet: WalletGateService,
    private readonly realtime: ChatRealtimePublisher,
    private readonly view: MessageViewService,
    @InjectQueue(QUEUES.MESSAGE_DISPATCH) private readonly queue: Queue,
  ) {}

  async enqueue(input: EnqueueOutboundInput): Promise<EnqueueOutboundResult> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    const sender = input.sender ?? { kind: 'agent' as const };

    const done = await this.db.tx(async (tx) => {
      const conv = await this.conversations.byUuid(tx, orgId, input.conversationId, true);
      if (!conv) throw conversationNotFound(input.conversationId);
      const channel = (await this.channelsRepo.byId(tx, orgId, conv.channelId))!;

      // The idempotency check comes first: a repeated request must get the first answer, not a refusal from rules that changed since.
      const seen = await this.messages.ledgerFind(
        tx,
        orgId,
        channel.id,
        'client_id',
        input.clientMessageId,
      );
      if (seen) {
        if (seen.conversationId !== conv.id) throw this.keyReused();
        const row = (await this.messages.byLedger(tx, orgId, seen))!;
        return { replayed: true as const, row, conv };
      }

      const runtime = await this.channels.runtime(tx, orgId, channel);
      // Cc, bcc and a subject belong to email: any other kind of channel has nowhere to put them.
      if (input.content.kind === 'text' && input.content.email && channel.kind !== 'email') {
        throw new AppError(
          ERROR_CODES.CHANNEL_CAPABILITY_UNSUPPORTED,
          'This channel cannot send cc, bcc or a subject',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'email', message: 'only an email conversation takes these' }],
        );
      }
      // @mentions exist only in a personal number's group thread; anywhere else they are dropped, not stored.
      let content = input.content;
      if (
        content.kind === 'text' &&
        content.mentions &&
        !(channel.kind === 'whatsapp_qr' && isGroupPeer(conv.peerKey))
      ) {
        const { mentions: _dropped, ...rest } = content;
        content = rest;
      }
      const fields = messageFieldsOf(content);
      const replyTo = input.replyToMessageId
        ? await this.replyTarget(tx, orgId, conv, input.replyToMessageId)
        : null;
      const isReaction = input.content.kind === 'reaction';
      if (isReaction && !(replyTo?.providerMessageId && REACTABLE.has(replyTo.kind))) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'That message cannot be reacted to',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [
            {
              path: 'targetMessageId',
              message: 'the message is not sent yet, or is not a message a customer sees',
            },
          ],
        );
      }

      const envelope = envelopeOf(
        {
          kind: fields.kind,
          body: fields.body,
          mediaKey: fields.media?.key ?? null,
          mediaMime: fields.media?.mime ?? null,
          mediaName: fields.media?.name ?? null,
          mediaSha256: fields.media?.sha256 ?? null,
          meta: fields.meta,
          latitude: fields.latitude ?? null,
          longitude: fields.longitude ?? null,
          clientMessageId: input.clientMessageId,
          uuid: input.clientMessageId,
        },
        conv.peerKey,
        replyTo?.providerMessageId ?? null,
        1,
      );
      const request = {
        channel: runtime,
        envelope,
        lastInboundAt: conv.lastInboundAt,
        source: 'inbox',
        // A reply or a utility template is service; a MARKETING template to a contact who unsubscribed is refused here, with no row.
        consent: {
          purpose: await this.dispatcher.purposeFor(orgId, envelope, tx),
          contactId: conv.contactId,
        },
      };
      const groupMembers = await this.assertGroupSendable(tx, orgId, runtime, conv.peerKey);
      await this.dispatcher.assertCanQueue(request, {
        monthlyUsed: await this.monthlyUsed(tx, orgId, runtime),
      });

      const alloc = await this.messages.allocate(tx);
      const fresh = await this.messages.ledgerInsert(
        tx,
        orgId,
        channel.id,
        'client_id',
        input.clientMessageId,
        {
          messageId: alloc.id,
          messageCreatedAt: alloc.createdAt,
          conversationId: conv.id,
        },
      );
      if (!fresh) throw this.keyReused();

      const after = await this.conversations.applyOutboundQueued(tx, orgId, conv.id, {
        messageId: alloc.id,
        arrivedAt: alloc.createdAt,
        preview: isReaction
          ? null
          : previewOf({
              kind: fields.kind,
              body: fields.body,
              locationName: (fields.meta.locationName as string | undefined) ?? null,
            }),
        reaction: isReaction,
      });
      await this.messages.insert(tx, orgId, {
        id: alloc.id,
        createdAt: alloc.createdAt,
        conversationId: conv.id,
        seq: after.msgSeq,
        direction: 'out',
        kind: fields.kind,
        senderKind: sender.kind,
        senderUserId: sender.kind === 'agent' ? (sender.userId ?? ctx.userId) : null,
        senderAgentId: sender.kind === 'bot' ? (sender.agentId ?? null) : null,
        body: fields.body,
        media: fields.media,
        latitude: fields.latitude ?? null,
        longitude: fields.longitude ?? null,
        status: 'queued',
        clientMessageId: input.clientMessageId,
        replyToMessageUuid: replyTo?.uuid ?? null,
        templateId: fields.templateId,
        // A message to a Cloud API group remembers how many people it was addressed to, for the "delivered to X of N" tally.
        meta: groupMembers === null ? fields.meta : { ...fields.meta, group_members: groupMembers },
      });
      await this.messages.insertEvent(
        tx,
        orgId,
        { id: alloc.id, createdAt: alloc.createdAt },
        'queued',
        {
          by: sender.kind === 'agent' ? (sender.userId ?? ctx.userId) : sender.kind,
        },
      );
      const row = (await this.messages.byId(tx, orgId, alloc.id, alloc.createdAt))!;
      return { replayed: false as const, row, conv: after };
    });

    if (!done.replayed) {
      await this.enqueueJob(orgId, done.row.uuid, 1);
      await this.realtime.messageStored(
        orgId,
        done.conv,
        done.row,
        done.row.kind === 'reaction' ? [] : ['lastMessage'],
      );
    }
    return { message: this.view.respond(done.row), replayed: done.replayed };
  }

  /**
   * The agent's Retry on a failed message: the same message goes back to `queued` (a new dispatch generation, so the job id is new)
   * and is checked again like a new send (the window may have closed, the channel may have been switched off, the cap may be full).
   */
  async retry(messageUuid: string): Promise<MessageResponse> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;

    const done = await this.db.tx(async (tx) => {
      const found = await this.messages.byUuid(tx, orgId, messageUuid);
      if (!found) throw this.messageNotFound(messageUuid);
      const conv = (await this.conversations.byId(tx, orgId, found.conversationId, true))!;
      // The lock was taken after the read: decide on the row as it is now.
      const row = (await this.messages.byId(tx, orgId, found.id, found.createdAtText))!;
      if (row.direction !== 'out' || row.status !== 'failed') {
        throw new AppError(
          ERROR_CODES.MESSAGE_NOT_RETRYABLE,
          'Only a failed message can be retried',
          HttpStatus.CONFLICT,
        );
      }
      const channel = (await this.channelsRepo.byId(tx, orgId, conv.channelId))!;
      const runtime = await this.channels.runtime(tx, orgId, channel);
      const replyTo = row.replyToMessageUuid
        ? await this.messages.byUuid(tx, orgId, row.replyToMessageUuid)
        : null;
      await this.assertGroupSendable(tx, orgId, runtime, conv.peerKey);
      const retryEnvelope = envelopeOf(row, conv.peerKey, replyTo?.providerMessageId ?? null, 1);
      await this.dispatcher.assertCanQueue(
        {
          channel: runtime,
          envelope: retryEnvelope,
          lastInboundAt: conv.lastInboundAt,
          source: 'inbox',
          consent: {
            purpose: await this.dispatcher.purposeFor(orgId, retryEnvelope, tx),
            contactId: conv.contactId,
          },
        },
        { monthlyUsed: await this.monthlyUsed(tx, orgId, runtime) },
      );

      const ref = { id: row.id, createdAt: row.createdAtText };
      const requeued = await this.messages.requeue(tx, orgId, ref);
      if (!requeued) {
        throw new AppError(
          ERROR_CODES.MESSAGE_NOT_RETRYABLE,
          'Only a failed message can be retried',
          HttpStatus.CONFLICT,
        );
      }
      await this.messages.insertEvent(tx, orgId, ref, 'retry', {
        manual: true,
        by: ctx.userId,
        generation: requeued.generation,
        // The provider had accepted the message once and then reported a failure: this Retry sends it again, as a new message there.
        ...(row.providerMessageId ? { previousProviderMessageId: row.providerMessageId } : {}),
        ...(row.failureCode ? { previousFailureCode: row.failureCode } : {}),
      });
      const after = (await this.messages.byId(tx, orgId, ref.id, ref.createdAt))!;
      return {
        row: after,
        conv,
        generation: requeued.generation,
        runtime,
        acceptedBefore: row.providerMessageId !== null,
      };
    });

    // The provider accepted the first send and then reported a failure (a receipt): its stored answer would make the worker "send" by
    // replaying that answer and put the message back to `sent` with the failure wiped. Forget it so the retry really goes out.
    if (done.acceptedBefore) {
      await this.dispatcher.forget(done.runtime, done.row.clientMessageId ?? done.row.uuid);
    }
    await this.enqueueJob(orgId, done.row.uuid, done.generation);
    await this.realtime.messageStatus(
      orgId,
      done.row.conversationUuid,
      done.row,
      'queued',
      new Date(),
    );
    return this.view.respond(done.row);
  }

  /** Puts a message on the dispatch queue. Used after a commit and by the recovery sweep; the deterministic job id makes a repeat a no-op. */
  async enqueueJob(orgId: number, messageUuid: string, generation: number): Promise<void> {
    const job: MessageSendJob = { orgId, messageUuid, generation };
    try {
      await this.queue.add(MESSAGE_SEND_JOB, job, {
        ...MESSAGE_SEND_JOB_OPTIONS,
        jobId: messageSendJobId(messageUuid, generation),
      });
    } catch (err) {
      // The message is stored `queued`; the recovery sweep will queue it. Failing the request would leave the agent unsure what happened.
      this.logger.warn(
        { orgId, messageUuid, err: (err as Error).message },
        'could not enqueue the send; the recovery sweep will',
      );
    }
  }

  /**
   * The recovery sweep's re-enqueue: a live job for this message is left alone (false); a finished or failed job that still holds the
   * id is removed first, because BullMQ would otherwise drop the new job as a duplicate of its own history.
   */
  async requeueJob(orgId: number, messageUuid: string, generation: number): Promise<boolean> {
    const id = messageSendJobId(messageUuid, generation);
    const existing = await this.queue.getJob(id);
    if (existing) {
      const state = await existing.getState();
      if (state !== 'failed' && state !== 'completed') return false;
      await existing.remove();
    }
    await this.enqueueJob(orgId, messageUuid, generation);
    return true;
  }

  // --- helpers -------------------------------------------------------------------------------------------------------------------

  /** Messages of metered channels sent this month, for a workspace whose plan has a cap; undefined skips the check. */
  private async monthlyUsed(
    tx: Tx,
    orgId: number,
    runtime: ChannelRuntime,
  ): Promise<number | undefined> {
    if (!runtime.settings.metered) return undefined;
    // An unlimited plan is the common case and must not pay for a count.
    if ((await this.plans.limit(orgId, 'monthly_messages')) === 0) return undefined;
    return this.messages.monthlyMeteredOutbound(tx, orgId, startOfUtcMonth(new Date()));
  }

  private async replyTarget(
    tx: Tx,
    orgId: number,
    conv: ConversationRow,
    messageUuid: string,
  ): Promise<MessageRow> {
    const target = await this.messages.byUuid(tx, orgId, messageUuid);
    if (!target || target.conversationId !== conv.id) throw this.messageNotFound(messageUuid);
    return target;
  }

  private messageNotFound(uuid: string): AppError {
    return new AppError(
      ERROR_CODES.MESSAGE_NOT_FOUND,
      `Message ${uuid} not found`,
      HttpStatus.NOT_FOUND,
    );
  }

  /**
   * A Cloud API group (`g:<group id>`): refuse before anything is stored or queued when the plan has no Groups (`waba_groups`,
   * 422 PLAN_FEATURE_LOCKED, the same gate as the management routes), when Meta suspended the group (D10), or when the workspace's own
   * wallet cannot cover one message to every member (D8). A group send is billed once per member, so the launch gate is asked for
   * `participant_count` recipients (at least one: the count is 0 until Meta's lifecycle webhook fills it). The gate is per workspace,
   * passes platform-owned workspaces and a plan's free allowance, and fails open if the billing lookup itself fails.
   * Returns the member count the message is addressed to (null for any thread that is not a Cloud API group).
   */
  private async assertGroupSendable(
    tx: Tx,
    orgId: number,
    runtime: ChannelRuntime,
    peerKey: string,
  ): Promise<number | null> {
    if (runtime.kind === 'whatsapp_qr' && isGroupPeer(peerKey)) {
      // A personal number's group: no wallet (one send is one message, D9), but the number must still be in it and allowed to write.
      await this.assertPersonalGroupSendable(tx, orgId, runtime, peerKey);
      return null;
    }
    if (runtime.kind !== 'whatsapp_cloud' || !isGroupPeer(peerKey)) return null;
    await this.plans.assertFeature(orgId, 'waba_groups');
    const found = await tx.execute(
      sql`SELECT suspended, participant_count FROM waba_groups
           WHERE org_id = ${orgId} AND group_id = ${groupIdOf(peerKey)} LIMIT 1`,
    );
    const row = found.rows[0] as { suspended?: boolean; participant_count?: number } | undefined;
    if (row?.suspended === true) {
      throw new AppError(
        ERROR_CODES.WABA_GROUP_SUSPENDED,
        'Meta suspended this group for a policy violation. It cannot be messaged until Meta clears it.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const members = Math.max(0, Number(row?.participant_count ?? 0));
    await this.wallet.assertCanLaunch({
      orgId,
      source: 'group_message',
      recipients: Math.max(1, members),
    });
    return members;
  }

  /** A group on a linked personal number: left (read-only thread) or announce-only without admin rights refuse before anything is stored. */
  private async assertPersonalGroupSendable(
    tx: Tx,
    orgId: number,
    runtime: ChannelRuntime,
    peerKey: string,
  ): Promise<void> {
    if (!runtime.externalId) return;
    const found = await tx.execute(
      sql`SELECT g.left_at, g.announce, g.is_admin
            FROM wa_device_groups g JOIN devices d ON d.org_id = g.org_id AND d.id = g.device_id
           WHERE g.org_id = ${orgId} AND d.uuid = ${runtime.externalId}::uuid
             AND g.group_jid = ${groupIdOf(peerKey)} LIMIT 1`,
    );
    const row = found.rows[0] as
      { left_at: Date | string | null; announce: boolean; is_admin: boolean } | undefined;
    const block = personalGroupSendBlock(
      row ? { leftAt: row.left_at, announce: row.announce, isAdmin: row.is_admin } : null,
    );
    if (block) {
      throw new AppError(
        block.code === 'WA_GROUP_LEFT'
          ? ERROR_CODES.WA_GROUP_LEFT
          : ERROR_CODES.WA_GROUP_ANNOUNCE_ONLY,
        block.message,
        block.code === 'WA_GROUP_LEFT' ? HttpStatus.CONFLICT : HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private keyReused(): AppError {
    return new AppError(
      ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
      'This clientMessageId was already used for a different message',
      HttpStatus.CONFLICT,
    );
  }
}
