import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { OUTBOX_EVENT_TYPES, OUTBOX_TO_WEBHOOK, matches } from './webhook-events';
import { DELIVERY_ATTEMPTS, DELIVERY_BACKOFF_MS, type WebhookDeliveryJob } from './webhook-job';
import { WebhooksRepository } from './webhooks.repository';

/**
 * Turns the workspace's outbox events into webhook deliveries: for each active endpoint subscribed to the event, one queued job.
 * The job id is the event id plus the endpoint, so the drain's at-least-once delivery cannot queue the same delivery twice.
 * A failure of one endpoint never touches another: each has its own job. Runs in the worker process under the event's own tenant.
 */
@Injectable()
export class WebhookDispatchConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'outbound-webhooks';
  readonly eventTypes = OUTBOX_EVENT_TYPES;
  private readonly logger = new Logger(WebhookDispatchConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WebhooksRepository,
    private readonly registry: OutboxSubscriberRegistry,
    @InjectQueue(QUEUES.WEBHOOK_DELIVER) private readonly queue: Queue<WebhookDeliveryJob>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const name = OUTBOX_TO_WEBHOOK[event.eventType];
    if (!name) return;
    const targets = await this.db.txAs({ orgId: event.orgId, userId: null }, (tx) =>
      this.repo.active(tx, event.orgId),
    );
    const hits = targets.filter((w) =>
      matches(Array.isArray(w.events) ? (w.events as string[]) : [], name),
    );
    if (hits.length === 0) return;
    const envelope = {
      id: event.id,
      event: name,
      createdAt: new Date().toISOString(),
      data: event.payload,
    };
    for (const w of hits) {
      await this.queue.add(
        'deliver',
        { orgId: event.orgId, webhookId: w.id, envelope },
        {
          jobId: `${event.id}-${w.id}`,
          attempts: DELIVERY_ATTEMPTS,
          backoff: { type: 'custom', delay: DELIVERY_BACKOFF_MS },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );
    }
    this.logger.debug({ event: name, endpoints: hits.length }, 'webhook deliveries queued');
  }
}
