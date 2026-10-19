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
 * Hands new and changed contacts, companies and deals to the engine (BL-013, BL-340..345): the ONE place record assignment runs, for every
 * write path (screen, API, import, form, lead source, flow, mobile), because each of them announces its record through the outbox. The
 * creation events assign a record that has no owner; the update events do the same for a record that still has none, and move a record
 * the engine itself assigned when a rule with "reassign on update" now matches. Events flagged `autoAssigned` (the engine's own writes)
 * are ignored, so an assignment can never start another. The engine is idempotent and runs after the write has committed, so it cannot
 * fail the write; a failure here is retried by the outbox. Worker only.
 */
@Injectable()
export class ContactAssignmentConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'contact-auto-assignment';
  readonly eventTypes = [
    'contact.created',
    'deal.created',
    'company.created',
    'form.submitted',
    'lead.created',
    'contact.updated',
    'company.updated',
    'deal.updated',
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
    const subject = subjectOf(event.eventType);
    const trigger = event.eventType.endsWith('.updated') ? 'updated' : 'created';
    const origin =
      event.eventType === 'form.submitted'
        ? 'form'
        : event.eventType === 'lead.created'
          ? 'lead'
          : originOf(event.payload.via);
    const r = await this.engine.assign(event.orgId, subject, uuid, origin, trigger);
    if (r.outcome === 'assigned' || r.outcome === 'reassigned') {
      this.logger.debug(
        { orgId: event.orgId, subject, rule: r.ruleId, outcome: r.outcome },
        'auto-assigned',
      );
    }
  }
}

const subjectOf = (eventType: string): 'contact' | 'company' | 'deal' =>
  eventType.startsWith('deal.') ? 'deal' : eventType.startsWith('company.') ? 'company' : 'contact';
