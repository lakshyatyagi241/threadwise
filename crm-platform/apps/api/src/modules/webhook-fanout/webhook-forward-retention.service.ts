import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { PlatformStore } from '../auth';
import { liveDaysFor, recordRun } from '../data-retention';

/** How long a failed delivery stays replayable. */
export const FAILURE_RETENTION_DAYS = 14;

/** Deletes expired failed deliveries in small batches, so the table (and the vacuum) stay small. Worker process only. */
@Injectable()
export class WebhookForwardRetentionService {
  private readonly logger = new Logger(WebhookForwardRetentionService.name);

  constructor(private readonly store: PlatformStore) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(): Promise<void> {
    try {
      const days = await this.store.tx((tx) =>
        liveDaysFor(tx, 'webhook_forward_failures', FAILURE_RETENTION_DAYS),
      );
      let total = 0;
      for (;;) {
        const res = await this.store.tx((tx) =>
          tx.execute(sql`
            DELETE FROM webhook_forward_failures WHERE id IN (
              SELECT id FROM webhook_forward_failures
              WHERE created_at < now() - make_interval(days => ${days})
              LIMIT 1000
            )
          `),
        );
        const n = res.rowCount ?? 0;
        total += n;
        if (n < 1000) break;
      }
      if (total > 0) this.logger.log({ deleted: total }, 'pruned expired webhook forward failures');
      await this.store
        .tx((tx) =>
          recordRun(tx, 'webhook_forward_failures', {
            mode: 'live',
            outcome: 'ok',
            deletedRows: total,
          }),
        )
        .catch((err: unknown) => this.logger.warn({ err }, 'could not record the retention run'));
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'webhook forward retention failed');
    }
  }
}
