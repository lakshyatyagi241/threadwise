import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../../kernel/outbox/outbox-subscribers';
import { ContactAssignmentEngine } from './contact-assignment.engine';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** How a created contact arrived, from the creating event's `via` (absent = a person or the API created it). */
export function originOf(via: unknown): string {
  const v = typeof via === 'string' ? via : '';
  if (v === 'import') return 'import';
  if (v === 'inbound' || v === 'whatsapp' || v === 'chat') return 'inbound';
  if (v === 'form') return 'form';
  if (v === 'lead' || v === 'lead_source') return 'lead';
  if (v === 'api') return 'api';
  return 'manual';
}

/**
 * Hands new contacts and deals to the engine (BL-013). Listens to the CREATION events only, and ignores any event flagged
 * `autoAssigned`: the engine's own writes (`contact.updated` with the new owner) can therefore never start another assignment. The engine
 * is idempotent (it acts only on a record that never had an owner), so a redelivery does nothing. Worker only.
 */
@Injectable()
export class ContactAssignmentConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'contact-auto-assignment';
  readonly eventTypes = [
    'contact.created',
    'deal.created',
    'form.submitted',
    'lead.created',
  ] as const;
  private readonly logger = new Logger(ContactAssignmentConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly engine: ContactAssignmentEngine,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    if (event.payload.autoAssigned === true) return;
    // Forms and lead sources create their contacts without a `contact.created`: their own events name the contact (a form only when it
    // created one; an existing contact that fills a form again keeps whoever owns it).
    if (event.eventType === 'form.submitted' && event.payload.created !== true) return;
    const uuid =
      event.eventType === 'form.submitted' || event.eventType === 'lead.created'
        ? str(event.payload.contactId)
        : str(event.payload.uuid);
    if (!uuid) return;
    const subject = event.eventType === 'deal.created' ? 'deal' : 'contact';
    const origin =
      event.eventType === 'form.submitted'
        ? 'form'
        : event.eventType === 'lead.created'
          ? 'lead'
          : subject === 'deal'
            ? 'manual'
            : originOf(event.payload.via);
    const r = await this.engine.assign(event.orgId, subject, uuid, origin);
    if (r.outcome === 'assigned') {
      this.logger.debug({ orgId: event.orgId, subject, rule: r.ruleId }, 'auto-assigned');
    }
  }
}
