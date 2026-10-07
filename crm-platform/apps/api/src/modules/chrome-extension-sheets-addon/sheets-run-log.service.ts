import { Injectable } from '@nestjs/common';
import type { ExtSheetsRowSummary } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';

export const SHEETS_SYNC_MODULE = 'ext_sheets_sync';

/**
 * One audit row and one outbox event per add-on write call (WD-EXT-014). Every contact and product row is audited by the service that
 * wrote it, as the member (the context carries their id); this is the summary that says it came from the Sheets add-on, how many rows it
 * carried and what happened to them, so "who loaded 500 contacts from a sheet" has an answer without joining a thousand audit rows.
 * Row contents are not copied here.
 */
@Injectable()
export class SheetsRunLog {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async record(
    settingsId: number,
    kind: 'contacts' | 'products',
    rows: number,
    summary: ExtSheetsRowSummary,
  ): Promise<void> {
    await this.db.tx(async (tx) => {
      await this.audit.record(tx, {
        module: SHEETS_SYNC_MODULE,
        recordId: settingsId,
        action: 'update',
        delta: {
          kind: { old: null, new: kind },
          rows: { old: null, new: rows },
          created: { old: null, new: summary.created },
          updated: { old: null, new: summary.updated },
          failed: { old: null, new: summary.failed },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: SHEETS_SYNC_MODULE,
        aggregateId: settingsId,
        eventType: 'ext.sheets.synced',
        payload: { kind, rows, ...summary },
      });
    });
  }
}
