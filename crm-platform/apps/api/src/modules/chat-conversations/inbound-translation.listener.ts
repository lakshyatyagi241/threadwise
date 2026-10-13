import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConversationTranslationService } from '../localization-translation';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import {
  InboundMessageHooks,
  type InboundMessageListener,
  type InboundStoredEvent,
} from './inbound-hooks';

/**
 * Real-time translation of a customer's text (TW-I18N-036): after the message is stored and committed, the I18N service reads
 * its language, stores the reading and pins the conversation's language. When it stored something, the open thread is told to
 * fetch again so the reading appears. Never consumes the message and never fails ingest (the hooks log a throw).
 */
@Injectable()
export class InboundTranslationListener implements InboundMessageListener, OnModuleInit {
  readonly name = 'i18n-translation';
  readonly runsOnEmail = true as const;

  constructor(
    private readonly hooks: InboundMessageHooks,
    private readonly translation: ConversationTranslationService,
    private readonly realtime: ChatRealtimePublisher,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async onStored(e: InboundStoredEvent): Promise<void> {
    if (e.message.kind !== 'text' || !e.message.body?.trim()) return;
    const outcome = await this.translation.translateInboundByUuid(e.orgId, e.messageUuid);
    if (outcome) await this.realtime.threadChanged(e.orgId, e.conversationUuid, 'translation');
  }
}
