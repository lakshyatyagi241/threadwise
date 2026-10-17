import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { LeadFirstReplyService } from './lead-first-reply.service';

/**
 * The outbox consumer of speed-to-lead (BL-014): `lead.created` (a lead became a NEW contact; a returning contact's `lead.updated` is
 * not "a new lead" and never gets a first message) schedules the lead's first message when its source has it switched on. Same pattern
 * as the new-lead notification: idempotent (the row's unique key is the lead event), runs in the worker under the event's own tenant.
 * It only schedules; the sending, with every check that must precede it, is `LeadFirstReplyService.processOne`.
 */
@Injectable()
export class LeadFirstReplyConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'lead-first-reply';
  readonly eventTypes = ['lead.created'] as const;

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly service: LeadFirstReplyService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    await this.service.schedule(event);
  }
}
