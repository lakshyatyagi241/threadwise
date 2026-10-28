import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../../kernel/outbox/outbox-subscribers';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../../chat-conversations';
import { FlowEngine } from '../runtime/engine.service';

/**
 * A person took a conversation over (worker process): the customer's live flow run on that channel stops, so the flow does not talk
 * over the agent (#1174, TW-FLR-050). An unassignment (toUserId null) takes nothing away. A conversation that is not in this workspace
 * is skipped. Errors propagate so the outbox retries the event.
 *
 * Redelivery is harmless: the outbox retries an event that failed, so the same takeover can arrive again later. The event carries
 * `assignedAt`, and only runs that started at or before it end, so a redelivered event cannot stop a flow started after the takeover.
 * An event without `assignedAt` (written before that field existed) keeps the old behaviour.
 */
@Injectable()
export class FlowTakeoverConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'flow-runtime-takeover';
  readonly eventTypes = ['conversation.assigned'] as const;

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly engine: FlowEngine,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload as {
      conversationId?: unknown;
      toUserId?: unknown;
      assignedAt?: unknown;
    };
    if (typeof p.conversationId !== 'string' || typeof p.toUserId !== 'string') return;
    const peer = await this.conversations.peerOfConversation(event.orgId, p.conversationId);
    if (!peer) return;
    const takenOverAt =
      typeof p.assignedAt === 'string' && !Number.isNaN(Date.parse(p.assignedAt))
        ? new Date(p.assignedAt)
        : null;
    await this.engine.endForPeer(event.orgId, peer.channelId, peer.peerKey, takenOverAt);
  }
}
