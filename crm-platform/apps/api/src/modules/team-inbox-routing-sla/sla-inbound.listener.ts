import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { RequestContextStore } from '../../common/context/request-context';
import {
  InboundMessageHooks,
  type InboundMessageListener,
  type InboundStoredEvent,
} from '../chat-conversations';
import { SlaClockService } from './sla-clock.service';

/**
 * The customer's message starts a response clock (TW-TIB2-026): on the first message of a new conversation and on the one that
 * brings a resolved or closed conversation back. A later message of a live thread leaves the running clock alone. Registered with the
 * inbound hooks in the worker only; it never consumes the message and never fails ingest. The opt-out (STOP) detection and the other
 * listeners are unaffected: this one only reads the event.
 */
@Injectable()
export class SlaInboundListener implements InboundMessageListener, OnModuleInit {
  readonly name = 'team-inbox-sla';
  readonly runsOnEmail = true as const;
  private readonly logger = new Logger(SlaInboundListener.name);

  constructor(
    private readonly hooks: InboundMessageHooks,
    private readonly clock: SlaClockService,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async onStored(e: InboundStoredEvent): Promise<void> {
    const reopenedFinished = e.reopenedFrom === 'resolved' || e.reopenedFrom === 'closed';
    if (!e.createdConversation && !reopenedFinished) return;
    const outcome = await RequestContextStore.run(
      {
        requestId: `sla-${e.messageUuid}`,
        orgId: e.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.clock.start(e.orgId, e.conversationUuid),
    );
    this.logger.debug(
      { orgId: e.orgId, conversation: e.conversationUuid, ...outcome },
      'sla start',
    );
  }
}
