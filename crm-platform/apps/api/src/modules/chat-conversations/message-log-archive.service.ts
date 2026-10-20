import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { gzipAsync } from '../../common/async-zlib';
import { DatabaseService } from '../../infra/db/database.service';
import { MessageLogRepository } from './message-log.repository';
import { recordSweep } from '../data-retention';
import { addDays, dayOf, dayStart, hotCutoff, retentionCutoff } from './message-log-rules';
import { messageLogWindows } from './message-log-windows';

/** Events read, and written as one gzip member, per round trip. */
const BATCH = 20_000;
/** Days archived in one run. A deployment that was off for a long time catches up over several nights instead of one huge one. */
const MAX_DAYS_PER_RUN = 45;
const PURGE_BATCH = 500;
const MAX_PURGE_BATCHES = 100;
/** An export `running` this long has lost its worker. */
const STUCK_EXPORT_MS = 60 * 60_000;

export interface ArchiveSweepResult {
  days: number;
  events: number;
  purgedDays: number;
  expiredExports: number;
  failedExports: number;
}

/**
 * The daily keeper of the message log (worker only). Events stay in `message_events` for MESSAGE_LOG_HOT_DAYS; this sweep then moves
 * each workspace's day of events, compressed, into `message_event_archives` and deletes the live rows in the SAME transaction, so an
 * event is always in exactly one place. It also deletes archive days past MESSAGE_LOG_RETENTION_DAYS, deletes the files of exports
 * older than their week, and fails an export whose worker died.
 *
 * Idempotent and resumable: a day is complete or untouched (one transaction per workspace and day), the next run starts from the
 * oldest event still in the live table, and an overlap of two runs is refused by the `running` flag (one process) and, across
 * processes, harmless: the second finds the rows gone.
 */
@Injectable()
export class MessageLogArchiveService {
  private readonly logger = new Logger(MessageLogArchiveService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MessageLogRepository,
  ) {}

  @Cron('17 2 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const out = await this.sweep();
      if (out.days + out.purgedDays + out.expiredExports + out.failedExports > 0) {
        this.logger.log(out, '[MSGLOG] archive sweep');
      }
    } catch (err) {
      this.logger.error({ err }, '[MSGLOG] archive sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. */
  async sweep(now: Date = new Date()): Promise<ArchiveSweepResult> {
    // The windows saved on the retention dashboard, read at every run; the built-in ones when nothing is saved.
    const windows = await this.db.privileged((tx) => messageLogWindows(tx));
    const cutoff = hotCutoff(now, windows.hotDays);
    let days = 0;
    let events = 0;
    let previous = '';
    while (days < MAX_DAYS_PER_RUN) {
      const oldest = await this.db.privileged((tx) => this.repo.oldestDue(tx, cutoff));
      if (!oldest) break;
      const day = dayOf(oldest);
      // The same day twice means nothing was removed: stop instead of looping on it.
      if (day === previous) break;
      previous = day;
      events += await this.archiveDay(day);
      days += 1;
    }

    let purgedDays = 0;
    // An archive kept for ever (`retentionDays` null) is never purged.
    if (windows.retentionDays !== null) {
      const retention = dayOf(retentionCutoff(now, windows.retentionDays));
      for (let i = 0; i < MAX_PURGE_BATCHES; i++) {
        const n = await this.db.privileged((tx) =>
          this.repo.purgeArchives(tx, retention, PURGE_BATCH),
        );
        purgedDays += n;
        if (n < PURGE_BATCH) break;
      }
    }

    const expiredExports = await this.db.privileged((tx) => this.repo.expireExports(tx, now));
    const failedExports = await this.db.privileged((tx) =>
      this.repo.failStuckExports(tx, now, STUCK_EXPORT_MS),
    );
    await recordSweep(
      this.db,
      this.logger,
      'message_log',
      { deletedRows: events, expiredItems: purgedDays },
      now,
    );
    return { days, events, purgedDays, expiredExports, failedExports };
  }

  /** Archives one UTC day of every workspace that has events on it. Returns how many events moved. */
  private async archiveDay(day: string): Promise<number> {
    const from = dayStart(day);
    const to = dayStart(addDays(day, 1));
    const orgs = await this.db.privileged((tx) => this.repo.orgsWithEvents(tx, from, to));
    let moved = 0;
    for (const orgId of orgs) {
      moved += await this.db.privileged(async (tx) => {
        const members: Buffer[] = [];
        let count = 0;
        let afterId = 0;
        for (;;) {
          const batch = await this.repo.dueBatch(tx, orgId, from, to, afterId, BATCH);
          if (batch.length === 0) break;
          members.push(await gzipAsync(`${batch.map((b) => JSON.stringify(b.line)).join('\n')}\n`));
          count += batch.length;
          afterId = batch[batch.length - 1]!.id;
          if (batch.length < BATCH) break;
        }
        if (count === 0) return 0;
        await this.repo.appendArchive(tx, orgId, day, count, Buffer.concat(members));
        const deleted = await this.repo.deleteArchived(tx, orgId, from, to, afterId);
        // Fewer rows gone than archived would mean the archive holds a copy of what is still live: leave both and surface it.
        if (deleted !== count) {
          throw new Error(
            `archive of ${day} for workspace ${orgId} moved ${count} events but deleted ${deleted}`,
          );
        }
        return count;
      });
    }
    return moved;
  }
}
