import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  CALL_EDIT_WINDOW_DEFAULT_HOURS,
  type CallLoggingSettings,
  type UpdateCallLoggingSettingsInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';

const MODULE = 'call_logging_settings';

interface SettingsRow {
  createContactsFromUnknownCallers: boolean;
  editWindowHours: number;
  rowVersion: number;
  updatedAt: string;
}

/** The saved row over the defaults: unknown callers are NOT turned into contacts, and the person who logged a call may change it for a day. */
export function mergeSettings(row: SettingsRow | null): CallLoggingSettings {
  return {
    createContactsFromUnknownCallers: row?.createContactsFromUnknownCallers ?? false,
    editWindowHours: row?.editWindowHours ?? CALL_EDIT_WINDOW_DEFAULT_HOURS,
    rowVersion: row?.rowVersion ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * The workspace's call logging rules (`call.logging.manage` writes them; anyone who may log a call reads them, because the edit window
 * decides what their screen offers). Every change is audited and emitted.
 */
@Injectable()
export class CallLoggingSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private async load(tx: Tx, orgId: number): Promise<SettingsRow | null> {
    const res = await tx.execute(sql`
      SELECT create_contacts_from_unknown_callers, edit_window_hours, row_version, updated_at
      FROM call_logging_settings WHERE org_id = ${orgId}`);
    const r = (res as { rows: Array<Record<string, unknown>> }).rows[0];
    return r
      ? {
          createContactsFromUnknownCallers: r.create_contacts_from_unknown_callers === true,
          editWindowHours: Number(r.edit_window_hours),
          rowVersion: Number(r.row_version),
          updatedAt: new Date(r.updated_at as string).toISOString(),
        }
      : null;
  }

  /** Inside a transaction the caller owns (the write paths read it once per request). */
  async readIn(tx: Tx, orgId: number): Promise<CallLoggingSettings> {
    return mergeSettings(await this.load(tx, orgId));
  }

  async get(): Promise<CallLoggingSettings> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx((tx) => this.readIn(tx, orgId));
  }

  async update(input: UpdateCallLoggingSettingsInput): Promise<CallLoggingSettings> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.load(tx, ctx.orgId);
      if ((before === null) !== (input.rowVersion === undefined)) {
        throw AppError.rowVersionConflict('Call logging settings');
      }
      if (before === null) {
        await tx.execute(sql`
          INSERT INTO call_logging_settings (org_id, create_contacts_from_unknown_callers, edit_window_hours, updated_by)
          VALUES (${ctx.orgId}, ${input.createContactsFromUnknownCallers}, ${input.editWindowHours}, ${ctx.userId})`);
      } else {
        const res = await tx.execute(sql`
          UPDATE call_logging_settings
          SET create_contacts_from_unknown_callers = ${input.createContactsFromUnknownCallers},
              edit_window_hours = ${input.editWindowHours}, updated_by = ${ctx.userId}
          WHERE org_id = ${ctx.orgId} AND row_version = ${input.rowVersion}
          RETURNING org_id`);
        if ((res as { rows: unknown[] }).rows.length !== 1) {
          throw AppError.rowVersionConflict('Call logging settings');
        }
      }
      const was = mergeSettings(before);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: ctx.orgId,
        action: before ? 'update' : 'insert',
        delta: {
          ...(was.createContactsFromUnknownCallers !== input.createContactsFromUnknownCallers && {
            createContactsFromUnknownCallers: {
              old: was.createContactsFromUnknownCallers,
              new: input.createContactsFromUnknownCallers,
            },
          }),
          ...(was.editWindowHours !== input.editWindowHours && {
            editWindowHours: { old: was.editWindowHours, new: input.editWindowHours },
          }),
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: ctx.orgId,
        eventType: 'call.logging.settings_changed',
        payload: {
          createContactsFromUnknownCallers: input.createContactsFromUnknownCallers,
          editWindowHours: input.editWindowHours,
        },
      });
      return this.readIn(tx, ctx.orgId);
    });
  }
}
