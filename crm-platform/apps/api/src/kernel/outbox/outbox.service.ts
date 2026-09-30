import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';

export interface OutboxEventInput {
  /** Module api_name of the changed aggregate, e.g. 'contacts'. */
  aggregateModule: string;
  aggregateId: number;
  /** Past tense, dotted: contact.created, campaign.completed, wallet.low_balance. */
  eventType: string;
  payload: Record<string, unknown>;
  /** Override the tenant — only for background jobs that are not request-scoped. */
  orgId?: number;
}

/**
 * Transactional outbox.
 *
 * The entire point is the word "transactional": the event row is written with
 * the SAME transaction as the business change. Either both commit or neither
 * does, so "the contact exists but nobody was notified" stops being a state
 * the system can reach.
 *
 * This is why `emit` takes a `tx` and not a database handle — you cannot call
 * it outside the transaction it is supposed to be part of.
 *
 * What belongs here: record CRUD, conversation/campaign/application lifecycle,
 * wallet postings. What does not: individual messages and delivery receipts.
 * At 5 lakh messages/day those would drown the drain, and they already have
 * their own durable log in `messages` / `message_events`.
 */
@Injectable()
export class OutboxService {
  async emit(tx: Tx, event: OutboxEventInput): Promise<void> {
    const orgId = event.orgId ?? RequestContextStore.orgId();
    const ctx = RequestContextStore.peek();

    await tx.execute(sql`
      INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
      VALUES (
        ${orgId},
        ${event.aggregateModule},
        ${event.aggregateId},
        ${event.eventType},
        ${JSON.stringify({
          ...event.payload,
          _meta: {
            requestId: ctx?.requestId ?? null,
            actorType: ctx?.actorType ?? 'system',
            actorId: ctx?.actorId ?? null,
          },
        })}::jsonb
      )
    `);
  }

  /** Several events in one statement — used by bulk imports and merges. */
  async emitMany(tx: Tx, events: OutboxEventInput[]): Promise<void> {
    for (const event of events) {
      await this.emit(tx, event);
    }
  }
}
