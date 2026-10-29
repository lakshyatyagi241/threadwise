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
 * over the agent (#1174, TW-FLR-050). An unassignment (toUserId null) takes nothing away. Neither does an assignment made by the flow
 * itself or by the system (`byUserId` null: a flow's Assign agent / Human handoff step, a routing rule): the node's own wiring decides
 * what happens next, so the steps after it still run. A conversation that is not in this workspace is skipped. Errors propagate so the
 * outbox retries the event.
 *
 * Delivery is at-least-once, so a redelivered event is possible long after the takeover. The event's own creation time is passed on:
 * only a run that started at or before the takeover is ended. A run the customer started after it (the conversation was handed back
 * and a new flow began) is left alone, so a repeat delivery of an old takeover is harmless (#1299).
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
    const p = event.payload as { conversationId?: unknown; toUserId?: unknown; byUserId?: unknown };
    if (typeof p.conversationId !== 'string' || typeof p.toUserId !== 'string') return;
    // Only a person acting ends the run; the payload carries no actor for a flow or the system.
    if (typeof p.byUserId !== 'string') return;
    const peer = await this.conversations.peerOfConversation(event.orgId, p.conversationId);
    if (!peer) return;
    await this.engine.endForPeer(event.orgId, peer.channelId, peer.peerKey, event.createdAt);
  }
}
