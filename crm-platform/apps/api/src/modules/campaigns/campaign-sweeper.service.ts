import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { PacingRuntime } from '../broadcasts';
import { CAMPAIGN_SETTINGS, type CampaignSettingsSource } from './_shims/tokens';
import { CampaignEvents } from './campaign-events';
import { CampaignJobs } from './campaign-jobs';
import { dateInZone, dueAtUtc, isEcosystemThrottle } from './campaign-rules';
import { CampaignsRepository } from './campaigns.repository';

/** Campaigns fired in one pass. */
const MAX_FIRED = 25;
/** A running campaign whose run has not been heard from for this long is taken for dead. */
const STALLED_SECONDS = 45;
/** A recipient claimed this long ago by a worker that died goes back to the queue. */
const CLAIM_MINUTES = 10;
const META_BLOCK_EVERY_MS = 10 * 60_000;

interface Row {
  id: number | string;
  uuid: string;
  org_id: number | string;
  timezone: string | null;
  schedule_type: string;
  send_date: string | Date | null;
  send_time: string | null;
}

/**
 * Keeps campaigns moving (TW-CAMP-014). Reference drove this from the Node bridge's heartbeat; here a worker does it every few
 * seconds, privileged because campaigns span every tenant:
 *
 *  1. recipients claimed by a run that died go back to the queue;
 *  2. a campaign stranded at `running` with unsent recipients and no sign of life is scheduled again, due now;
 *  3. every ten minutes, recipients reported failed by a webhook with no retry planned: Meta's ecosystem throttle (131049) stays
 *     resendable, anything else is final, so a resend never re-messages an opt-out or a dead number;
 *  4. every `scheduled` or `recurring` campaign whose date and time have come is started: `running`, and a run is queued.
 */
@Injectable()
export class CampaignSweeper {
  private readonly logger = new Logger(CampaignSweeper.name);
  private running = false;
  private lastMetaBlocks = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CampaignsRepository,
    private readonly events: CampaignEvents,
    private readonly jobs: CampaignJobs,
    private readonly runtime: PacingRuntime,
    @Inject(CAMPAIGN_SETTINGS) private readonly settings: CampaignSettingsSource,
  ) {}

  @Interval(5_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const fired = await this.sweep();
      if (fired > 0) this.logger.log({ fired }, '[CAMP] due campaigns started');
    } catch (err) {
      this.logger.error({ err }, '[CAMP] sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. Returns how many campaigns were started. */
  async sweep(): Promise<number> {
    const started: Array<{ orgId: number; id: number; uuid: string }> = [];
    await this.db.privileged(async (tx) => {
      await tx.execute(sql`
        UPDATE wp_campaign_contacts SET status = 'queued'
        WHERE status = 'pending' AND updated_at < now() - ${`${CLAIM_MINUTES} minutes`}::interval`);

      await this.resumeStalled(tx);
      if (this.runtime.now().getTime() - this.lastMetaBlocks >= META_BLOCK_EVERY_MS) {
        this.lastMetaBlocks = this.runtime.now().getTime();
        await this.reconcileMetaBlocks(tx);
      }

      const res = await tx.execute(sql`
        SELECT id, uuid, org_id, timezone, schedule_type, send_date, to_char(send_time, 'HH24:MI') AS send_time
        FROM wpcampaigns
        WHERE status = 'scheduled' AND schedule_type IN ('scheduled', 'recurring') AND send_date IS NOT NULL
          AND send_date <= (now() AT TIME ZONE 'UTC')::date + 1
        ORDER BY send_date, send_time LIMIT ${MAX_FIRED} FOR UPDATE SKIP LOCKED`);
      for (const r of res.rows as unknown as Row[]) {
        const date =
          r.send_date instanceof Date
            ? r.send_date.toISOString().slice(0, 10)
            : String(r.send_date).slice(0, 10);
        const due = dueAtUtc(date, r.send_time, r.timezone);
        if (!due || due.getTime() > this.runtime.now().getTime()) continue;
        const orgId = Number(r.org_id);
        const id = Number(r.id);
        await this.repo.setStatus(tx, orgId, id, 'running', { lastRun: true });
        await this.events.statusChanged(tx, orgId, id, 'scheduled');
        started.push({ orgId, id, uuid: r.uuid });
      }
    });
    // Queued after the commit: a job must never run before the status it needs is visible.
    for (const s of started) await this.jobs.enqueue(s.orgId, s.id, s.uuid);
    return started.length;
  }

  /** Back to `scheduled`, due now in the campaign's own zone, so the same pass fires it. */
  private async resumeStalled(tx: Parameters<CampaignsRepository['count']>[0]): Promise<void> {
    const res = await tx.execute(sql`
      SELECT id, uuid, org_id, timezone, schedule_type FROM wpcampaigns
      WHERE status = 'running' AND coalesce(last_run_at, created_at) < now() - ${`${STALLED_SECONDS} seconds`}::interval
      ORDER BY coalesce(last_run_at, created_at) LIMIT 100`);
    for (const r of res.rows as unknown as Row[]) {
      const orgId = Number(r.org_id);
      const id = Number(r.id);
      const { retryAttempts } = await this.settings.get(tx, orgId);
      const pending = await tx.execute(sql`
        SELECT 1 FROM wp_campaign_contacts
        WHERE org_id = ${orgId} AND campaign_id = ${id}
          AND (status IN ('queued', 'pending') OR (status = 'failed' AND send_attempts < ${Math.max(1, retryAttempts)}))
        LIMIT 1`);
      if (pending.rows.length === 0) continue;
      const now = this.runtime.now();
      const zone = r.timezone ?? 'UTC';
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
      }).format(now);
      await this.repo.setSchedule(tx, orgId, id, {
        scheduleType: r.schedule_type === 'recurring' ? 'recurring' : 'scheduled',
        sendDate: dateInZone(now, zone),
        sendTime: time,
      });
      await this.repo.setStatus(tx, orgId, id, 'scheduled');
      this.logger.warn({ campaign: r.uuid }, '[CAMP] a stalled run was scheduled again');
    }
  }

  private async reconcileMetaBlocks(
    tx: Parameters<CampaignsRepository['count']>[0],
  ): Promise<void> {
    const res = await tx.execute(sql`
      SELECT DISTINCT org_id, campaign_id FROM wp_campaign_contacts
      WHERE status = 'failed' AND send_attempts < 3 AND next_attempt_at IS NULL LIMIT 25`);
    for (const r of res.rows as Array<{ org_id: number | string; campaign_id: number | string }>) {
      const orgId = Number(r.org_id);
      const id = Number(r.campaign_id);
      const c = await this.repo.findById(tx, orgId, id);
      if (!c || ['cancelled', 'paused', 'draft', 'scheduled', 'running'].includes(c.status))
        continue;
      // A wizard broadcast's frequency-cap failures belong to the wizard's own retry job (24 hours apart, or none): never re-run here.
      if (c.wizard !== null) continue;
      const { retryAttempts } = await this.settings.get(tx, orgId);
      const max = Math.max(1, retryAttempts);
      const rows = await tx.execute(sql`
        SELECT id, error_message FROM wp_campaign_contacts
        WHERE org_id = ${orgId} AND campaign_id = ${id} AND status = 'failed' AND send_attempts < ${max} AND next_attempt_at IS NULL`);
      let retryable = false;
      for (const x of rows.rows as Array<{ id: number | string; error_message: string | null }>) {
        if (isEcosystemThrottle(x.error_message ?? '')) retryable = true;
        else
          await tx.execute(
            sql`UPDATE wp_campaign_contacts SET send_attempts = ${max} WHERE org_id = ${orgId} AND id = ${Number(x.id)}`,
          );
      }
      if (!retryable) continue;
      const now = this.runtime.now();
      const zone = c.timezone ?? 'UTC';
      await this.repo.setSchedule(tx, orgId, id, {
        scheduleType: 'scheduled',
        sendDate: dateInZone(now, zone),
        sendTime: new Intl.DateTimeFormat('en-GB', {
          timeZone: zone,
          hourCycle: 'h23',
          hour: '2-digit',
          minute: '2-digit',
        }).format(now),
      });
      await this.repo.setStatus(tx, orgId, id, 'scheduled');
    }
  }
}
