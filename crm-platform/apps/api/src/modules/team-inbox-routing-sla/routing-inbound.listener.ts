import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { RequestContextStore } from '../../common/context/request-context';
import {
  InboundMessageHooks,
  type InboundMessageListener,
  type InboundStoredEvent,
} from '../chat-conversations';
import { RoutingEngine } from './routing-engine.service';

/**
 * The inbox's inbound message meets the routing rules (TW-TIB2-010). Registered with the inbound hooks in the worker process only, so
 * it runs after the message's transaction committed and never inside a request. It reacts to the first message of a new conversation
 * and to the one that reopens a finished conversation; any later message of a live thread is left alone (an agent's reassignment is
 * never trampled). It never consumes the message: the flow runtime and the auto replies run as before.
 *
 * Idempotent: the hooks run once per stored message (a redelivery is a ledger duplicate and never gets here), and the engine also
 * remembers the message it routed for on the conversation.
 */
@Injectable()
export class RoutingInboundListener implements InboundMessageListener, OnModuleInit {
  readonly name = 'team-inbox-routing';
  private readonly logger = new Logger(RoutingInboundListener.name);

  constructor(
    private readonly hooks: InboundMessageHooks,
    private readonly engine: RoutingEngine,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async onStored(e: InboundStoredEvent): Promise<void> {
    if (!e.createdConversation && !e.reopenedFrom) return;
    const outcome = await RequestContextStore.run(
      {
        requestId: `route-${e.messageUuid}`,
        orgId: e.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.engine.route({
          orgId: e.orgId,
          conversationUuid: e.conversationUuid,
          messageUuid: e.messageUuid,
          messageText: e.message.kind === 'text' ? e.message.body : null,
        }),
    );
    this.logger.log({ orgId: e.orgId, conversation: e.conversationUuid, ...outcome }, 'routing');
  }
}
