import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { GrowthAutomationService } from './growth-automation.service';

/**
 * When a conversation is handed to a person, put the AI's summary of the thread at the top (worker process). Only for the pilot: the
 * automation service answers `false` to any other workspace before it reads anything. The note is written once per event (its key is
 * the event id), so a redelivery does nothing.
 */
@Injectable()
export class GrowthHandoverConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'growth-handover';
  readonly eventTypes = ['conversation.assigned'] as const;
  private readonly logger = new Logger(GrowthHandoverConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly automation: GrowthAutomationService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload as { conversationId?: unknown; toUserId?: unknown };
    // An unassignment (toUserId null) hands the thread to nobody.
    if (typeof p.conversationId !== 'string' || typeof p.toUserId !== 'string') return;
    try {
      await this.automation.handover(event.orgId, p.conversationId, `handover:${event.id}`);
    } catch (err) {
      // A courtesy note must never hold back the other consumers of the same event.
      this.logger.warn({ orgId: event.orgId, err }, 'handover summary not written');
    }
  }
}
