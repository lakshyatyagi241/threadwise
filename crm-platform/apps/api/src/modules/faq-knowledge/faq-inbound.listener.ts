import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  InboundMessageHooks,
  type InboundMessageListener,
  type InboundStoredEvent,
} from '../chat-conversations';
import { FaqAnswerService } from './faq-answer.service';

/**
 * The FAQ on the inbound message (ADR-0021): after the flows had their turn, a typed message that a workspace's FAQs answer gets the
 * answer (or its flow starts), when the workspace switched FAQ answering on. It never answers a message a flow already took, and
 * answering counts as taking it, so an auto reply or an AI agent behind it stays quiet. Worker only, like every inbound listener.
 */
@Injectable()
export class FaqInboundListener implements InboundMessageListener, OnModuleInit {
  readonly name = 'faq-knowledge';
  readonly after = true as const;

  constructor(
    private readonly hooks: InboundMessageHooks,
    private readonly answers: FaqAnswerService,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async onStored(
    e: InboundStoredEvent,
    prior: { consumed: boolean },
  ): Promise<{ consumed: boolean }> {
    if (prior.consumed || e.message.kind !== 'text' || !e.message.body?.trim()) {
      return { consumed: false };
    }
    return { consumed: await this.answers.handleInbound(e) };
  }
}
