import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CALL_RECORDING_RETENTION_DEFAULT_DAYS } from '@crm/contracts';
import { liveDaysFor, recordSweep } from '../data-retention';
import { DatabaseService } from '../../infra/db/database.service';
import { ChatMediaStore } from '../../infra/providers/chat-conversations/media';
import { CallRecordingRepository } from './call-recording.repository';
import { CallsRepository } from './calls.repository';

const BATCH = 200;
const MAX_BATCHES = 50;

/**
 * The daily retention sweep for call recordings (worker only, BL-144, spec 4.6): a recording older than its workspace's window
 * (default 90 days) is deleted from storage and forgotten by the call row; the call stays. A legal hold skips it. Each recording is
 * locked and re-checked in its own transaction, so a hold placed meanwhile wins. A storage failure leaves the recording for the next run.
 */
@Injectable()
export class CallRecordingRetentionService {
  private readonly logger = new Logger(CallRecordingRetentionService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallRecordingRepository,
    private readonly calls: CallsRepository,
    private readonly media: ChatMediaStore,
  ) {}

  @Cron('23 3 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const out = await this.sweep();
      if (out.deleted + out.failed > 0) this.logger.log(out, '[CALL] recording retention sweep');
    } catch (err) {
      this.logger.error({ err }, '[CALL] recording retention sweep failed');
    } finally {
      this.running = false;
    }
  }

  async sweep(now: Date = new Date()): Promise<{ deleted: number; failed: number }> {
    await this.db.privileged((tx) => this.repo.stampUnclocked(tx));
    // The platform default for a workspace that never chose its own window; a workspace's own window still wins.
    const defaultDays = await this.db.privileged((tx) =>
      liveDaysFor(tx, 'call_recordings', CALL_RECORDING_RETENTION_DEFAULT_DAYS),
    );
    let deleted = 0;
    let failed = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const batch = await this.db.privileged((tx) =>
        this.repo.expired(tx, now, BATCH, defaultDays),
      );
      if (batch.length === 0) break;
      let progressed = 0;
      for (const r of batch) {
        try {
          const done = await this.db.txAs({ orgId: r.orgId, userId: null }, async (tx) => {
            const ok = await this.repo.lockExpired(tx, r.orgId, r.id, r.key, now, defaultDays);
            if (!ok) return false;
            await this.media.remove(r.orgId, r.key);
            await this.repo.writeRemoved(tx, r.orgId, r.id, 'retention');
            await this.calls.logEvent(tx, r.orgId, r.id, 'recording_deleted', {
              reason: 'retention',
            });
            return true;
          });
          if (done) {
            deleted++;
            progressed++;
          }
        } catch (err) {
          failed++;
          this.logger.warn({ orgId: r.orgId, callId: r.id, err }, '[CALL] recording not deleted');
        }
      }
      if (progressed === 0) break;
    }
    await recordSweep(
      this.db,
      this.logger,
      'call_recordings',
      {
        deletedRows: deleted,
        outcome: failed > 0 ? 'partial' : 'ok',
        error: failed > 0 ? `${failed} recordings could not be deleted` : null,
      },
      now,
    );
    return { deleted, failed };
  }
}
