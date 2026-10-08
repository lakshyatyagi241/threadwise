import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { PushSubscriptionsRepository } from './push-subscriptions.repository';

/** A revoked device is kept this long (so a browser that comes back after a hiccup can re-enable) and then deleted. */
const REVOKED_KEEP_DAYS = 30;

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
    const cutoff = new Date(now.getTime() - REVOKED_KEEP_DAYS * 86_400_000);
    const deleted = await this.db.privileged((tx) => this.repo.pruneRevoked(tx, cutoff));
    if (deleted > 0) this.logger.log({ deleted }, 'revoked push devices pruned');
    return deleted;
  }
}
