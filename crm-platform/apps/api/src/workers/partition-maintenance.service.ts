import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../infra/db/database.service';

/** Time-partitioned tables. Add new ones here the day they are created. */
const PARTITIONED_TABLES = ['event_outbox', 'audit_log'];

/** How many months ahead to keep partitions. */
const MONTHS_AHEAD = 3;

/**
 * Keeps monthly partitions ahead of the clock.
 *
 * A missing partition is not a slow query — it is an INSERT that fails, which
 * means dropped audit rows and a stalled outbox. Running three months ahead
 * means the job can be broken for weeks before anyone is woken up.
 *
 * Also runs once at boot, so a fresh environment is never one restart away
 * from the same failure.
 */
@Injectable()
export class PartitionMaintenanceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PartitionMaintenanceService.name);

  constructor(private readonly db: DatabaseService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensurePartitions();
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async ensurePartitions(): Promise<void> {
    try {
      await this.db.privileged(async (tx) => {
        for (const table of PARTITIONED_TABLES) {
          for (let offset = 0; offset <= MONTHS_AHEAD; offset += 1) {
            await tx.execute(sql`
              SELECT ensure_monthly_partition(
                ${table}::regclass,
                (date_trunc('month', now()) + (${offset} || ' months')::interval)::date
              )
            `);
          }
        }
      });
      this.logger.log(
        { tables: PARTITIONED_TABLES, monthsAhead: MONTHS_AHEAD },
        'partitions ensured',
      );
    } catch (err) {
      this.logger.error({ err }, 'partition maintenance failed');
    }
  }

  /**
   * Alerting hook: rows in a DEFAULT partition mean maintenance fell behind
   * and data landed in the catch-all. Queries still work, but the partition
   * boundaries no longer prune — and new partitions cannot be created until
   * the default is cleared.
   */
  async defaultPartitionCounts(): Promise<Record<string, number>> {
    return this.db.privileged(async (tx) => {
      const counts: Record<string, number> = {};
      for (const table of PARTITIONED_TABLES) {
        const result = await tx.execute(
          sql.raw(`SELECT count(*)::int AS count FROM ${table}_default`),
        );
        counts[table] = Number((result.rows[0] as { count: number }).count);
      }
      return counts;
    });
  }
}
