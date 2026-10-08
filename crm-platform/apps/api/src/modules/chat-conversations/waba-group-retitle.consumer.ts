import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { WabaGroupThreadTitleService } from './waba-group-thread-title.service';

export const WABA_GROUP_RETITLE_EVENTS = [
  'whatsapp.group.created',
  'whatsapp.group.updated',
] as const;

/**
 * Keeps a WhatsApp group thread's title in step with the group's subject (spec 12.5). `created` covers the first message arriving before the
 * lifecycle webhook told us the subject; `updated` covers a rename. Runs in the worker; at-least-once delivery is safe (the title is set, not
 * toggled).
 */
@Injectable()
export class WabaGroupRetitleConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'chat-waba-group-retitle';
  readonly eventTypes = WABA_GROUP_RETITLE_EVENTS;

  constructor(
    private readonly titles: WabaGroupThreadTitleService,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    const subject = typeof p.subject === 'string' ? p.subject : '';
    const changed = Array.isArray(p.changed) ? (p.changed as unknown[]) : [];
    // Only when the subject is part of what moved; a new member joining must not touch the thread.
    if (!subject || !changed.includes('subject')) return;
    await this.titles.retitle(
      event.orgId,
      String(p.connectionId ?? ''),
      String(p.groupId ?? ''),
      subject,
    );
  }
}
