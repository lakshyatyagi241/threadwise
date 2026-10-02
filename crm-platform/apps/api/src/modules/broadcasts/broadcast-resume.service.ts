import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { EmergencyHaltService } from '../auth';
import { BroadcastProgressService } from './broadcast-progress.service';
import { PacingRuntime } from './send-safety';

interface Paused {
  id: number | string;
  uuid: string;
  org_id: number | string;
  reason: string | null;
  resume_after: string | null;
}

/**
 * Resumes the broadcasts that can resume on their own (WD-BCAST-022). WaDesk had no resume at all.
 *  - a daily cap: after its `resumeAfter` instant (midnight UTC);
 *  - the emergency halt: once the halt is lifted.
 * A broadcast paused any other way waits for a person (`POST /v2/broadcasts/:id/resume`).
 *
 * Runs privileged: paused broadcasts span every tenant, like the other sweeps.
 */
@Injectable()
export class BroadcastResumeService {
  private readonly logger = new Logger(BroadcastResumeService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly progress: BroadcastProgressService,
    private readonly outbox: OutboxService,
    private readonly halt: EmergencyHaltService,
    private readonly runtime: PacingRuntime,
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.log({ resumed: n }, '[BCAST] paused broadcasts resumed');
    } catch (err) {
      this.logger.error({ err }, '[BCAST] resume sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. Returns how many broadcasts were resumed. */
  async sweep(): Promise<number> {
    const halted = await this.halt.isHalted();
    const now = this.runtime.now();
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, uuid, org_id, messages_log -> 'pause' ->> 'reason' AS reason, messages_log -> 'pause' ->> 'resumeAfter' AS resume_after
        FROM broadcasts
        WHERE status = 'paused' AND messages_log -> 'pause' IS NOT NULL
        ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED`);
      let resumed = 0;
      for (const p of res.rows as unknown as Paused[]) {
        const ready =
          (p.reason === 'daily_cap' &&
            p.resume_after !== null &&
            new Date(p.resume_after).getTime() <= now.getTime()) ||
          (p.reason === 'halt' && !halted);
        if (!ready) continue;
        const orgId = Number(p.org_id);
        const id = Number(p.id);
        await this.progress.resume(tx, orgId, id);
        await this.outbox.emit(tx, {
          orgId,
          aggregateModule: 'broadcasts',
          aggregateId: id,
          eventType: 'broadcast.resumed',
          payload: { uuid: p.uuid, auto: true, reason: p.reason },
        });
        resumed++;
      }
      return resumed;
    });
  }
}
