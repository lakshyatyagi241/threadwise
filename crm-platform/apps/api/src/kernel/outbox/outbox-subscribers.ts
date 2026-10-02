import { Injectable, Logger } from '@nestjs/common';

/** One claimed outbox row as a subscriber sees it. */
export interface OutboxEvent {
  /** event_outbox.id (bigint, as text): unique per event, stable across redeliveries. */
  id: string;
  orgId: number;
  aggregateModule: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * A consumer of outbox events.
 *
 * Delivery is at-least-once, so `handle` MUST be idempotent (a redelivered event must not do its work twice).
 * Throwing makes the drain retry the event with backoff, and re-delivers it to every subscriber that matches, so
 * subscribers must also tolerate being called again for an event they already handled.
 */
export interface OutboxSubscriber {
  /** Stable name, for logs. */
  readonly name: string;
  /** Exact event types ('task.assigned') this subscriber wants. */
  readonly eventTypes: readonly string[];
  handle(event: OutboxEvent): Promise<void>;
}

/**
 * Where subscribers announce themselves. Lives in the kernel (it knows nothing about any domain): a module's worker
 * module registers its consumer here, and the drain loop in `workers/` fans each event out to the ones that match.
 */
@Injectable()
export class OutboxSubscriberRegistry {
  private readonly logger = new Logger(OutboxSubscriberRegistry.name);
  private readonly subscribers: OutboxSubscriber[] = [];

  register(subscriber: OutboxSubscriber): void {
    if (this.subscribers.some((s) => s.name === subscriber.name)) return;
    this.subscribers.push(subscriber);
  }

  /**
   * Hands the event to every matching subscriber. One subscriber failing never stops the others (each is awaited
   * on its own); if any failed, this throws after all have run so the drain retries the event, and the ones that
   * succeeded see it again, which idempotency makes harmless.
   */
  async dispatch(event: OutboxEvent): Promise<void> {
    const matching = this.subscribers.filter((s) => s.eventTypes.includes(event.eventType));
    if (matching.length === 0) return;
    const results = await Promise.allSettled(matching.map((s) => s.handle(event)));
    const failures: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const why = r.reason instanceof Error ? r.reason.message : String(r.reason);
        this.logger.warn(
          { subscriber: matching[i]!.name, eventType: event.eventType, eventId: event.id, why },
          'outbox subscriber failed',
        );
        failures.push(`${matching[i]!.name}: ${why}`);
      }
    });
    if (failures.length > 0) throw new Error(failures.join('; '));
  }
}
