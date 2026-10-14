import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../infra/db/database.service';
import { OwnerReassignRepository } from './owner-reassign.repository';
import { OwnerReassignService } from './owner-reassign.service';

const BATCH = 20;

/**
 * The automatic return (BL-112 phase 2, opt-in per reassignment): on the day a person is back (`restore_on`, the workspace's own
 * calendar) the batch is restored as the system. Claimed with `FOR UPDATE SKIP LOCKED`, so however many workers run a batch is
 * restored once; each restore and its status are one transaction. Runs privileged: it spans every workspace by definition (a sanctioned
 * use). Imported by WorkersModule only.
 */
@Injectable()
export class OwnerRestoreSweepService {
  private readonly logger = new Logger(OwnerRestoreSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: OwnerReassignRepository,
    private readonly reassign: OwnerReassignService,
  ) {}

  @Interval(300_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.debug({ restored: n }, 'owner restore sweep');
    } catch (err) {
      this.logger.error({ err }, 'owner restore sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass; returns how many batches were handled. */
  async sweep(limit = BATCH): Promise<number> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT b.org_id, b.uuid FROM owner_reassign_batches b JOIN organizations o ON o.id = b.org_id
        WHERE b.status = 'applied' AND b.restore_on IS NOT NULL
          AND b.restore_on <= (now() AT TIME ZONE coalesce(
                (SELECT n.name FROM pg_timezone_names n WHERE n.name = o.settings ->> 'timezone'), 'UTC'))::date
        ORDER BY b.restore_on, b.id LIMIT ${limit}
        FOR UPDATE OF b SKIP LOCKED`);
      for (const r of res.rows as Array<{ org_id: unknown; uuid: string }>) {
        const orgId = Number(r.org_id);
        const batch = await this.repo.byUuid(tx, orgId, r.uuid, true);
        if (!batch || batch.status !== 'applied') continue;
        await this.repo.lockPerson(tx, orgId, batch.fromUserId);
        await this.reassign.restoreInTx(
          tx,
          orgId,
          batch,
          { actorId: null, actorType: 'system', requestId: null },
          null,
        );
      }
      return res.rows.length;
    });
  }
}
