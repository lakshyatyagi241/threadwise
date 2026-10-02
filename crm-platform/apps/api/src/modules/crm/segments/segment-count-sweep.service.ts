import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../infra/db/database.service';
import { countWithTimeout, segmentContactsWhere } from './segment-count';
import { compileSegment } from './segment-filter';
import { SegmentsRepository } from './segments.repository';

const BATCH = 25;
/** A segment nobody has opened for this long is not worth counting. */
const USED_WITHIN = '24 hours';
/** Counts younger than this are left alone (the request path's TTL is 5 minutes). */
const REFRESH_AFTER = '4 minutes';

/**
 * Keeps the cached member count of recently used segments warm, so opening a segment shows its
 * size without anybody waiting for a count. Every minute it takes the segments someone used in the
 * last day whose count is older than four minutes, oldest first, and counts them, each in its own
 * tenant transaction under the 3 second ceiling (an approximate answer is not stored: the old count
 * stays until a count completes).
 *
 * Reading the list of due segments spans workspaces, so it runs privileged (one of the sanctioned
 * uses); every count after that runs as the segment's own tenant. Imported by WorkersModule only.
 */
@Injectable()
export class SegmentCountSweepService {
  private readonly logger = new Logger(SegmentCountSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SegmentsRepository,
  ) {}

  @Interval(60_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.debug({ refreshed: n }, 'segment count sweep');
    } catch (err) {
      this.logger.error({ err }, 'segment count sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass; returns how many counts were stored. */
  async sweep(limit = BATCH): Promise<number> {
    const due = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, id FROM segments
        WHERE last_used_at > now() - ${USED_WITHIN}::interval
          AND (member_count_at IS NULL OR member_count_at < now() - ${REFRESH_AFTER}::interval)
        ORDER BY member_count_at NULLS FIRST, id
        LIMIT ${limit}
      `);
      return (res.rows as Array<{ org_id: number | string; id: number | string }>).map((r) => ({
        orgId: Number(r.org_id),
        id: Number(r.id),
      }));
    });

    let stored = 0;
    for (const { orgId, id } of due) {
      try {
        stored += await this.db.txAs({ orgId, userId: null }, async (tx) => {
          const row = await this.repo.findById(tx, orgId, id);
          if (!row) return 0;
          const filter = await compileSegment(tx, orgId, row);
          const counted = await countWithTimeout(tx, segmentContactsWhere(orgId, filter.where), {
            fallback: row.memberCountCache,
          });
          if (counted.approximate) return 0;
          await this.repo.storeCount(tx, orgId, id, counted.count);
          return 1;
        });
      } catch (err) {
        // One broken segment must not stop the others.
        this.logger.warn({ err, orgId, segmentId: id }, 'segment count failed');
      }
    }
    return stored;
  }
}
