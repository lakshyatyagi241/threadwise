import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { historyImportConfig } from '../../config/domains/whatsapp-history-import.env';
import { DatabaseService } from '../../infra/db/database.service';
import { HistoryImportRepository } from './history-import.repository';
import { HistoryImportService } from './history-import.service';

export const HISTORY_SWEEP_TICK_MS = 30_000;

/**
 * Ends the runs nobody will end (worker, every workspace): a running import that has been quiet for `WA_HISTORY_IMPORT_IDLE_FINISH_SECONDS`
 * (`WA_HISTORY_IMPORT_FULL_IDLE_FINISH_SECONDS` for a `full` one; the importer touches the run at the start of every batch and while it stores a long one, so a run that is
 * busy is never quiet) is finished as `done` with `ended_idle` (progress is left as WhatsApp reported it) (WhatsApp sends no "that was all" marker we can rely on), and one that was asked for but whose history never came
 * (`WA_HISTORY_IMPORT_AWAIT_MINUTES`: never linked, or WhatsApp sent none) is failed with `history_not_received`. Both are idempotent: a
 * run that a cancel or another worker already ended is left alone.
 */
@Injectable()
export class HistoryImportSweepService {
  private readonly logger = new Logger(HistoryImportSweepService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: HistoryImportRepository,
    private readonly service: HistoryImportService,
  ) {}

  @Interval(HISTORY_SWEEP_TICK_MS)
  async tick(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error({ err: String(err) }, '[HISTORY] sweep failed');
    }
  }

  /** One pass; returns how many runs were ended. */
  async run(): Promise<number> {
    const cfg = historyImportConfig();
    const due = await this.db.privileged((tx) =>
      this.repo.dueForSweep(
        tx,
        { recent: cfg.idleFinishSeconds, full: cfg.fullIdleFinishSeconds },
        cfg.awaitMinutes,
      ),
    );
    let ended = 0;
    for (const r of due.quiet) {
      // WhatsApp did not say it was done (no last slice at progress 100): the run ends as done, but with the reason, and without a made-up 100.
      if (await this.service.finishAs(r.org_id, r.id, 'done', 'ended_idle')) ended++;
    }
    for (const r of due.stale) {
      if (await this.service.finishAs(r.org_id, r.id, 'failed', 'history_not_received')) ended++;
    }
    return ended;
  }
}
