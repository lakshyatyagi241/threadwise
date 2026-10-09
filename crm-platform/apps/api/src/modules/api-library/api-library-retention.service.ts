import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { API_LIBRARY_LOG_RETENTION_DAYS } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';

const BATCH = 1000;
const MAX_BATCHES = 50;

/**
 * The daily sweep of the API Library's run log: rows older than API_LIBRARY_LOG_RETENTION_DAYS are deleted, a batch at a time. The
 * log is a partitioned stream, so the volume that matters is the last month; the delete runs privileged to reach every workspace in one
 * statement (the list of expired rows is not tenant data). Imported by the worker module only.
 */
@Injectable()
export class ApiLibraryRetentionService {
  private readonly logger = new Logger(ApiLibraryRetentionService.name);
  private running = false;

  constructor(private readonly db: DatabaseService) {}

  @Cron('41 3 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const deleted = await this.sweep();
      if (deleted > 0) this.logger.log({ deleted }, 'api library log retention sweep');
    } catch (err) {
      this.logger.error({ err }, 'api library log retention sweep failed');
    } finally {
      this.running = false;
    }
  }

  async sweep(): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = await this.db.privileged(async (tx) => {
        const res = await tx.execute(sql`
          DELETE FROM api_library_logs
          WHERE (id, created_at) IN (
            SELECT id, created_at FROM api_library_logs
            WHERE created_at < now() - make_interval(days => ${API_LIBRARY_LOG_RETENTION_DAYS}) LIMIT ${BATCH})
          RETURNING 1`);
        return res.rows.length;
      });
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }
}
