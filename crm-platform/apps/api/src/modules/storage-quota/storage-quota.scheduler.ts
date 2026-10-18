import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { StorageModeService } from './storage-mode.service';
import { StorageQuotaPublisher } from './storage-quota.publisher';
import { StorageQuotaRepository } from './storage-quota.repository';

/** Workspaces whose backfill is queued per pick-up: the object store sees a trickle, not a wave. */
export const BACKFILL_PICKUP_BATCH = 3;
/** The nightly fan-out spreads its jobs by this much each, so a thousand workspaces take a few minutes, not a burst. */
export const RECONCILE_SPREAD_MS = 250;
/** Expired reservations returned per reaper pass, and passes per tick. */
const REAP_BATCH = 1000;
const REAP_PASSES = 20;

/**
 * The clocks of the storage meter (worker only):
 *  - every 5 minutes, the reaper returns reservations that were never committed or released (a crash between "reserved" and "committed"
 *    cannot hold space for ever);
 *  - every 10 minutes, a few workspaces that were never backfilled are queued (so observe mode fills in by itself, slowly);
 *  - every night, the counter check of every workspace is queued, spread over the following minutes.
 * All of it is skipped when the mode is `off`.
 */
@Injectable()
export class StorageQuotaScheduler {
  private readonly logger = new Logger(StorageQuotaScheduler.name);
  private reaping = false;
  private picking = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StorageQuotaRepository,
    private readonly publisher: StorageQuotaPublisher,
    private readonly mode: StorageModeService,
  ) {}

  @Interval(5 * 60_000)
  async reap(): Promise<void> {
    if (this.reaping) return;
    this.reaping = true;
    try {
      await this.reapOnce();
    } catch (err) {
      this.logger.error({ err }, '[STORAGE] reservation reaper failed');
    } finally {
      this.reaping = false;
    }
  }

  async reapOnce(now: Date = new Date()): Promise<{ reaped: number; bytes: number }> {
    const total = { reaped: 0, bytes: 0 };
    for (let i = 0; i < REAP_PASSES; i += 1) {
      const pass = await this.db.privileged((tx) => this.repo.reapExpired(tx, now, REAP_BATCH));
      total.reaped += pass.reaped;
      total.bytes += pass.bytes;
      if (pass.reaped < REAP_BATCH) break;
    }
    if (total.reaped > 0) this.logger.log(total, '[STORAGE] returned expired reservations');
    return total;
  }

  @Interval(10 * 60_000)
  async pickUpBackfill(): Promise<void> {
    if (this.picking) return;
    this.picking = true;
    try {
      await this.pickUpBackfillOnce();
    } catch (err) {
      this.logger.error({ err }, '[STORAGE] backfill pick-up failed');
    } finally {
      this.picking = false;
    }
  }

  async pickUpBackfillOnce(): Promise<number[]> {
    if ((await this.mode.current()) === 'off') return [];
    const orgIds = await this.db.privileged((tx) =>
      this.repo.orgsToBackfill(tx, BACKFILL_PICKUP_BATCH),
    );
    for (const orgId of orgIds) await this.publisher.enqueueBackfill(orgId);
    return orgIds;
  }

  @Cron('17 3 * * *')
  async nightly(): Promise<void> {
    try {
      await this.fanOutReconcile();
    } catch (err) {
      this.logger.error({ err }, '[STORAGE] nightly fan-out failed');
    }
  }

  async fanOutReconcile(now: Date = new Date()): Promise<number> {
    if ((await this.mode.current()) === 'off') return 0;
    const day = now.toISOString().slice(0, 10);
    const orgIds = await this.db.privileged((tx) => this.repo.allOrgIds(tx));
    let i = 0;
    for (const orgId of orgIds) {
      await this.publisher.enqueueReconcile(orgId, day, i * RECONCILE_SPREAD_MS);
      i += 1;
    }
    this.logger.log({ workspaces: orgIds.length }, '[STORAGE] nightly counter check queued');
    return orgIds.length;
  }
}
