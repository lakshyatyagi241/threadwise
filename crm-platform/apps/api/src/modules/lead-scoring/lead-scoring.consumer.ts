import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { LeadScoringService } from './lead-scoring.service';

/**
 * Queues a contact for scoring when it is created or its details change (worker process). It only queues: the vendor call is the
 * queue's job. Idempotent: the queue's job id is per contact, so a redelivered event or ten edits in a row become one score.
 * `contact.stage_changed` counts as a change too (a stage move is the strongest signal there is).
 */
@Injectable()
export class LeadScoringConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'lsc-auto-score';
  readonly eventTypes = ['contact.created', 'contact.updated', 'contact.stage_changed'] as const;
  private readonly logger = new Logger(LeadScoringConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly scoring: LeadScoringService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const contactId = Number(event.aggregateId);
    if (!Number.isInteger(contactId)) return;
    try {
      await this.scoring.enqueueIfAuto(
        event.orgId,
        contactId,
        event.eventType === 'contact.created' ? 'created' : 'updated',
      );
    } catch (err) {
      // Scoring is an extra: a queue hiccup must never hold back the other consumers of the same event.
      this.logger.warn({ orgId: event.orgId, contactId, err }, 'lead scoring not queued');
    }
  }
}
