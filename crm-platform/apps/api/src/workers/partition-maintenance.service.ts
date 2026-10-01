import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../infra/db/database.service';

/** How many months ahead to keep partitions. */
const MONTHS_AHEAD = 3;

interface PartitionedParent {
  parent: string;
  /** The `DEFAULT` partition, if the table has one. Every stream is meant to. */
  defaultPartition: string | null;
}

/**
 * Keeps monthly partitions ahead of the clock.
 *
 * A missing partition is not a slow query — it is an INSERT that fails, which
 * means dropped audit rows and a stalled outbox. Running three months ahead
 * means the job can be broken for weeks before anyone is woken up.
 *
 * The tables are read from the catalog on every run rather than listed here:
 * a hand-kept list is a step every new stream migration has to remember, and
 * the failure when it is forgotten arrives months later, after the bootstrap
 * partitions run out and rows start piling up in the `_default` partition.
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
    let tables: string[];
    try {
      tables = (await this.partitionedParents()).map((p) => p.parent);
    } catch (err) {
      this.logger.error({ err }, 'partition maintenance failed to list partitioned tables');
      return;
    }

    // One transaction per table. Tables are discovered, so one nobody planned
    // for (a RANGE key that is not a date, a default partition that already
    // holds rows for the month being created) must not roll back the
    // partitions of event_outbox and audit_log along with it.
    const failed: string[] = [];
    for (const table of tables) {
      try {
        await this.db.privileged(async (tx) => {
          for (let offset = 0; offset <= MONTHS_AHEAD; offset += 1) {
            await tx.execute(sql`
              SELECT ensure_monthly_partition(
                ${table}::regclass,
                (date_trunc('month', now()) + (${offset} || ' months')::interval)::date
              )
            `);
          }
        });
      } catch (err) {
        failed.push(table);
        this.logger.error({ err, table }, 'partition maintenance failed for table');
      }
    }

    if (failed.length === 0) {
      this.logger.log({ tables, monthsAhead: MONTHS_AHEAD }, 'partitions ensured');
    }
  }

  /**
   * Alerting hook: rows in a DEFAULT partition mean maintenance fell behind
   * and data landed in the catch-all. Queries still work, but the partition
   * boundaries no longer prune — and new partitions cannot be created until
   * the default is cleared.
   */
  async defaultPartitionCounts(): Promise<Record<string, number>> {
    const parents = await this.partitionedParents();
    return this.db.privileged(async (tx) => {
      const counts: Record<string, number> = {};
      for (const { parent, defaultPartition } of parents) {
        if (defaultPartition === null) continue;
        const result = await tx.execute(
          sql`SELECT count(*)::int AS count FROM ${sql.identifier('public')}.${sql.identifier(defaultPartition)}`,
        );
        counts[parent] = Number((result.rows[0] as { count: number }).count);
      }
      return counts;
    });
  }

  /**
   * Parents only: `NOT relispartition` leaves out the partitions themselves, so
   * a sub-partitioned child is not mistaken for a stream. RANGE only: hash and
   * list tables are not time-based and `ensure_monthly_partition` cannot
   * create a partition for them.
   */
  private async partitionedParents(): Promise<PartitionedParent[]> {
    return this.db.privileged(async (tx) => {
      const result = await tx.execute(sql`
        SELECT c.relname AS parent,
               (SELECT d.relname
                  FROM pg_inherits i
                  JOIN pg_class d ON d.oid = i.inhrelid
                 WHERE i.inhparent = c.oid
                   AND pg_get_expr(d.relpartbound, d.oid) = 'DEFAULT') AS default_partition
          FROM pg_partitioned_table p
          JOIN pg_class c ON c.oid = p.partrelid
         WHERE c.relnamespace = 'public'::regnamespace
           AND NOT c.relispartition
           AND p.partstrat = 'r'
         ORDER BY c.relname
      `);
      return (result.rows as { parent: string; default_partition: string | null }[]).map((r) => ({
        parent: r.parent,
        defaultPartition: r.default_partition,
      }));
    });
  }
}
