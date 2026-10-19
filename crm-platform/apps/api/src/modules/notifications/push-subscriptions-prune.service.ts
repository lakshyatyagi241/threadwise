import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { liveDaysFor, recordSweep } from '../data-retention';
import { PushSubscriptionsRepository } from './push-subscriptions.repository';

/**
 * Deletes browser devices revoked more than 30 days ago (the push service said 404 / 410, or the keys stopped matching). Daily, in the
 * worker. Spans every workspace like the outbox drain, so it runs privileged; it reads nothing, it deletes by age. Safe on several pods
 * and safe to repeat.
 */
@Injectable()
export class PushSubscriptionsPruneService {
  private readonly logger = new Logger(PushSubscriptionsPruneService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PushSubscriptionsRepository,
  ) {}

  @Cron('0 40 3 * * *')
  async daily(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error({ err }, 'push subscription prune failed');
    }
  }

  async runOnce(now: Date = new Date()): Promise<number> {
    // A revoked device is kept briefly (so a browser that comes back after a hiccup can re-enable), then deleted: the item's default.
    const days = await this.db.privileged((tx) => liveDaysFor(tx, 'push_devices_revoked'));
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const deleted = await this.db.privileged((tx) => this.repo.pruneRevoked(tx, cutoff));
    await recordSweep(this.db, this.logger, 'push_devices_revoked', { deletedRows: deleted }, now);
    if (deleted > 0) this.logger.log({ deleted }, 'revoked push devices pruned');
    return deleted;
  }
}
