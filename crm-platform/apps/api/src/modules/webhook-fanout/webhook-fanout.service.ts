import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../infra/queue/queues';
import { PlatformStore } from '../auth';
import {
  FORWARD_BACKOFF,
  MAX_FORWARD_BYTES,
  forwardJobId,
  matchesFilter,
  type ForwardJob,
} from './webhook-fanout.rules';

interface ActiveTarget {
  id: number;
  fieldFilter: string[] | null;
  maxAttempts: number;
}

/** How long the active-target list is reused. Edits are seen within this window on every API pod. */
const CACHE_MS = 5_000;

/**
 * The enqueue side, called from the WhatsApp webhook receiver after the signature check and before anything is
 * parsed into work. It does no HTTP: it reads a tiny cached list and adds one job per matching target, so Meta is
 * answered at the same speed as before. Any failure here is logged and swallowed: forwarding must never make Meta
 * retry a webhook our own ingest has already accepted.
 */
@Injectable()
export class WebhookFanoutService {
  private readonly logger = new Logger(WebhookFanoutService.name);
  private cache: { at: number; targets: ActiveTarget[] } | null = null;

  constructor(
    private readonly store: PlatformStore,
    @InjectQueue(QUEUES.WEBHOOK_FORWARD) private readonly queue: Queue<ForwardJob>,
  ) {}

  /** Call after a target is created, changed or removed in this process, so its own pod sees it at once. */
  invalidate(): void {
    this.cache = null;
  }

  async forward(input: {
    rawBody: Buffer;
    signatureHeader?: string;
    contentType?: string;
    fields: string[];
  }): Promise<number> {
    try {
      if (input.rawBody.length > MAX_FORWARD_BYTES) {
        this.logger.warn({ bytes: input.rawBody.length }, 'webhook body too large to forward');
        return 0;
      }
      const targets = (await this.activeTargets()).filter((t) =>
        matchesFilter(t.fieldFilter, input.fields),
      );
      if (targets.length === 0) return 0;
      const body = input.rawBody.toString('base64');
      await this.queue.addBulk(
        targets.map((t) => ({
          name: 'forward',
          data: {
            targetId: t.id,
            body,
            signatureHeader: input.signatureHeader ?? null,
            contentType: input.contentType ?? null,
          },
          opts: {
            jobId: forwardJobId(t.id, input.rawBody),
            attempts: t.maxAttempts,
            backoff: FORWARD_BACKOFF,
            removeOnComplete: { count: 500, age: 3600 },
            removeOnFail: { count: 500, age: 24 * 3600 },
          },
        })),
      );
      return targets.length;
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'webhook fan-out enqueue failed');
      return 0;
    }
  }

  private async activeTargets(): Promise<ActiveTarget[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.targets;
    const rows = await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, field_filter, max_attempts FROM webhook_forward_targets WHERE is_active ORDER BY id`,
      );
      return res.rows as unknown as Array<{
        id: number | string;
        field_filter: string[] | null;
        max_attempts: number;
      }>;
    });
    const targets = rows.map((r) => ({
      id: Number(r.id),
      fieldFilter: r.field_filter,
      maxAttempts: r.max_attempts,
    }));
    this.cache = { at: now, targets };
    return targets;
  }
}
