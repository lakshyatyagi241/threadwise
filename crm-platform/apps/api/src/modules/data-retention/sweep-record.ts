import type { Logger } from '@nestjs/common';
import type { RetentionItemId } from '@crm/contracts';
import type { DatabaseService } from '../../infra/db/database.service';
import { recordRun } from './retention-store';

/**
 * Writes what a nightly sweep did to the retention dashboard ("last run"). Best effort: a sweep that deleted its rows must never be
 * reported as failed because the note about it could not be saved.
 */
export async function recordSweep(
  db: DatabaseService,
  logger: Logger,
  item: RetentionItemId,
  run: {
    deletedRows?: number;
    expiredItems?: number;
    outcome?: 'ok' | 'partial' | 'failed';
    error?: string | null;
  },
  now: Date = new Date(),
): Promise<void> {
  await db
    .privileged((tx) =>
      recordRun(
        tx,
        item,
        {
          mode: 'live',
          outcome: run.outcome ?? 'ok',
          deletedRows: run.deletedRows ?? 0,
          expiredItems: run.expiredItems ?? 0,
          error: run.error ?? null,
        },
        now,
      ),
    )
    .catch((err: unknown) => logger.warn({ err, item }, 'could not record the retention run'));
}
