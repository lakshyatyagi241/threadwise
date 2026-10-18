import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { DatabaseService } from '../../infra/db/database.service';
import { orgIdList } from '../../common/sql/org-id-list';
import { addOrRevive } from '../../infra/queue/add-or-revive';
import { QUEUES } from '../../infra/queue/queues';
import type { BroadcastDispatchJob } from './broadcast-dispatch.processor';

const BATCH = 50;

/**
 * Hands every due broadcast to the dispatch queue (TW-BCAST-016, 021).
 *
 * Reference kept a scheduled broadcast only in Node's memory and lost it on a restart; here the broadcast row is the schedule.
 * A broadcast is due when it is `processing` or `scheduled`, its time has come and no job was queued for it yet.
 * The job id is the broadcast uuid, so queueing twice (a crash between the queue and the commit) is a no-op, while a finished job left
 * from an earlier run is replaced so a resumed or retried broadcast really runs.
 *
 * Runs privileged: due broadcasts span every tenant, like the outbox drain.
 */
@Injectable()
export class BroadcastDueService {
  private readonly logger = new Logger(BroadcastDueService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    @InjectQueue(QUEUES.BCAST_DISPATCH) private readonly queue: Queue<BroadcastDispatchJob>,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  @Interval(3_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const queued = await this.enqueueDue();
      if (queued > 0) this.logger.log({ queued }, '[BCAST] due broadcasts queued');
    } catch (err) {
      this.logger.error({ err }, '[BCAST] queueing due broadcasts failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. */
  async enqueueDue(): Promise<number> {
    // Broadcasts on the unofficial engine stay untouched while it is off for their workspace (owner decisions 2026-10-05, 2026-10-06) and are queued once it is on.
    // Decided per row's workspace (owner decision 2026-10-06): the platform switch on AND the row's org on the allow-list.
    const allowedOrgs = orgIdList(await this.unofficial.enabledOrgIds());
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, uuid, org_id FROM broadcasts
        WHERE status IN ('processing', 'scheduled') AND node_schedule_id IS NULL AND scheduled_at <= now()
          AND (provider IS DISTINCT FROM 'baileys' OR org_id = ANY(${allowedOrgs}))
        ORDER BY scheduled_at, id LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED`);
      const rows = res.rows as Array<{
        id: number | string;
        uuid: string;
        org_id: number | string;
      }>;
      for (const r of rows) {
        // The row says nothing is queued, so a job of this id that already finished (a run being resumed or retried) is stale and must
        // not swallow the add; one that is still waiting or running is the crash-between-queue-and-commit duplicate and stays.
        await addOrRevive(
          this.queue,
          'dispatch',
          { orgId: Number(r.org_id), broadcastId: Number(r.id) },
          { jobId: r.uuid, replaceStates: ['failed', 'completed'] },
        );
        await tx.execute(sql`
          UPDATE broadcasts SET node_schedule_id = ${`bullmq:${r.uuid}`}, status = 'processing'
          WHERE org_id = ${Number(r.org_id)} AND id = ${Number(r.id)}`);
      }
      return rows.length;
    });
  }
}
