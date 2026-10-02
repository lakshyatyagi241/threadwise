import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { verifyShopifyWebhook, verifyWooWebhook } from './event-rules';
import { EventsRepository } from './events.repository';
import type { StoreKind } from './mirror-rules';
import { EcomSettingsService } from './platform-settings.service';
import { StoresRepository } from './stores.repository';
import type { WebhookJob } from './webhook-pipeline.service';

export interface WebhookResult {
  status: 200 | 401 | 404 | 503;
  body: string;
}

export interface WebhookHeaders {
  signature: string;
  topic: string;
  deliveryId: string;
}

const REPLAY_SECONDS = 86_400;

/**
 * The public door a store's webhooks knock on (WD-ECOM-008, 027). The address carries the store's secret, which only finds the
 * store; the signature proves the sender. A verified delivery is logged, queued for the worker, and answered 200 at once, because
 * the store retries and eventually disables a webhook that answers slowly or with an error.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly stores: StoresRepository,
    private readonly events: EventsRepository,
    private readonly settings: EcomSettingsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(QUEUES.ECOM_WEBHOOK) private readonly queue: Queue<WebhookJob>,
  ) {}

  async receive(
    kind: StoreKind,
    secret: string,
    raw: Buffer,
    h: WebhookHeaders,
  ): Promise<WebhookResult> {
    const hit = await this.lookup(kind, secret);
    if (!hit) return { status: 404, body: 'not found' };
    const { orgId, storeId } = hit;

    const store = await this.db.txAs({ orgId }, (tx) =>
      this.stores.storeById(tx, orgId, kind, storeId),
    );
    if (!store) return { status: 404, body: 'not found' };

    const key =
      kind === 'shopify' ? (await this.settings.shopify()).clientSecret : store.webhookSecret;
    const holds =
      kind === 'shopify'
        ? verifyShopifyWebhook(raw, h.signature, key)
        : verifyWooWebhook(raw, h.signature, key);
    if (!holds) return { status: 401, body: kind === 'shopify' ? 'bad hmac' : 'bad signature' };

    // A store's own ping or an unreadable body is acknowledged and dropped.
    const data = parse(raw);
    if (!data) return { status: 200, body: 'ok' };

    const deliveryId = h.deliveryId || createHash('sha256').update(raw).digest('hex');
    const replayKey = `ecom:delivery:${kind}:${storeId}:${deliveryId}`;
    if ((await this.redis.set(replayKey, '1', 'EX', REPLAY_SECONDS, 'NX')) !== 'OK')
      return { status: 200, body: 'ok' };

    try {
      const eventType = h.topic || 'unknown';
      const log = await this.db.txAs({ orgId }, (tx) =>
        this.events.log(tx, orgId, kind, storeId, {
          eventType,
          status: store.status === 'connected' ? 'received' : 'skipped',
          payload: data,
          error: store.status === 'connected' ? null : 'The store is not connected.',
        }),
      );
      if (store.status !== 'connected') return { status: 200, body: 'ok' };
      await this.queue.add(
        'delivery',
        {
          orgId,
          kind,
          storeId,
          eventType,
          data,
          log: { id: log.id, createdAt: log.createdAt.toISOString() },
          phase: 'full',
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
      return { status: 200, body: 'ok' };
    } catch (err) {
      // Not accepted: forget the delivery so the store's retry is processed, and tell it to retry.
      this.logger.error({ orgId, kind, storeId, err }, '[ECOM] webhook not queued');
      await this.redis.del(replayKey).catch(() => undefined);
      return { status: 503, body: 'try again' };
    }
  }

  /** The store a webhook address belongs to. Through a SECURITY DEFINER lookup: no tenant exists yet on a public route. */
  private async lookup(
    kind: StoreKind,
    secret: string,
  ): Promise<{ orgId: number; storeId: number } | null> {
    if (secret.length < 16 || secret.length > 128) return null;
    const res = await this.db.primary.execute(
      sql`SELECT * FROM ecom_store_lookup(${kind}, ${secret})`,
    );
    const r = res.rows[0] as
      { store_org_id: number | string; store_row_id: number | string } | undefined;
    return r ? { orgId: Number(r.store_org_id), storeId: Number(r.store_row_id) } : null;
  }
}

function parse(raw: Buffer): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw.toString('utf8'));
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
