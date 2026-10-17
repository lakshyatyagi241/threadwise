import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { CALL_RECORDING_RETENTION_DEFAULT_DAYS } from '@crm/contracts';
import { DatabaseService } from '../../../infra/db/database.service';

/** A click-to-call whose finished call never came back is forgotten after this many days. */
const PLACEMENT_DAYS = 2;

/**
 * The daily sweep of the call logging framework (worker only). A reference to a recording on a provider is held as long as the
 * workspace's recording window says (default 90 days, 7 to 365; the same setting as a WhatsApp recording): after it the reference is
 * cleared and the date of the clearing kept, the call stays. Placements that were never reported on are forgotten too.
 */
@Injectable()
export class CallLogRetentionService {
  private readonly logger = new Logger(CallLogRetentionService.name);
  private running = false;

  constructor(private readonly db: DatabaseService) {}

  @Cron('41 3 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const out = await this.sweep();
      if (out.recordings + out.placements > 0) this.logger.log(out, '[CALL] call log sweep');
    } catch (err) {
      this.logger.error({ err }, '[CALL] call log sweep failed');
    } finally {
      this.running = false;
    }
  }

  async sweep(): Promise<{ recordings: number; placements: number }> {
    return this.db.privileged(async (tx) => {
      const cleared = await tx.execute(sql`
        UPDATE call_log_entries e
        SET recording_ref = NULL, recording_deleted_at = now()
        WHERE e.recording_ref IS NOT NULL
          AND e.recording_stored_at < now() - make_interval(days => coalesce(
                (SELECT s.retention_days FROM call_recording_settings s WHERE s.org_id = e.org_id),
                ${CALL_RECORDING_RETENTION_DEFAULT_DAYS}))
        RETURNING e.id`);
      const placements = await tx.execute(sql`
        DELETE FROM telephony_click_calls WHERE created_at < now() - make_interval(days => ${PLACEMENT_DAYS}) RETURNING id`);
      return {
        recordings: (cleared as { rows: unknown[] }).rows.length,
        placements: (placements as { rows: unknown[] }).rows.length,
      };
    });
  }
}
