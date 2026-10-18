import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  mergeUncontactedSettings,
  type LeadHandlingSection,
  type LeadHandlingSettings,
  type UncontactedSettings,
  type UncontactedSettingsValues,
  type UpdateUncontactedSettingsInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';

export const LEAD_HANDLING_MODULE = 'lead_followup_settings';

interface SectionRow {
  section: LeadHandlingSection;
  config: unknown;
  rowVersion: number;
  updatedAt: Date;
}

/** Flattens a settings document to `a.b.c` leaves, for a field-level audit delta. */
export function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? { [prefix]: value } : {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

/** The leaves that differ between two documents, as an audit delta. */
export function settingsDelta(
  before: unknown,
  after: unknown,
): Record<string, { old: unknown; new: unknown }> {
  const a = flatten(before);
  const b = flatten(after);
  const delta: Record<string, { old: unknown; new: unknown }> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[key] !== b[key]) delta[key] = { old: a[key] ?? null, new: b[key] ?? null };
  }
  return delta;
}

/**
 * The workspace's lead handling settings (BL-290..292): one row per section in `lead_followup_settings`. A section that was never saved
 * reads as its defaults, so nothing changes for a workspace until somebody saves. Writes carry the section's `rowVersion` (409 on a
 * stale one, like every settings document here); the audit row and the outbox event commit with the write.
 *
 * Event hooks (the touch service) read through `readIn` inside the transaction of the action they belong to: one primary-key row, no
 * cache, so a toggle takes effect on the very next action in every process.
 */
@Injectable()
export class LeadHandlingSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The given sections' rows in one round trip (a section without a row is absent from the map). */
  async readIn(
    tx: Tx,
    orgId: number,
    sections: readonly LeadHandlingSection[],
  ): Promise<Map<LeadHandlingSection, SectionRow>> {
    const res = await tx.execute(sql`
      SELECT section, config, row_version, updated_at FROM lead_followup_settings
      WHERE org_id = ${orgId} AND section IN (${sql.join(
        sections.map((s) => sql`${s}`),
        sql`, `,
      )})
    `);
    const rows = new Map<LeadHandlingSection, SectionRow>();
    for (const r of res.rows as Array<Record<string, unknown>>) {
      rows.set(r.section as LeadHandlingSection, {
        section: r.section as LeadHandlingSection,
        config: r.config,
        rowVersion: Number(r.row_version),
        updatedAt: new Date(r.updated_at as string),
      });
    }
    return rows;
  }

  /** The uncontacted section as the hooks need it: merged over the defaults. */
  async uncontactedIn(tx: Tx, orgId: number): Promise<UncontactedSettingsValues> {
    const rows = await this.readIn(tx, orgId, ['uncontacted']);
    return mergeUncontactedSettings(rows.get('uncontacted')?.config);
  }

  async get(): Promise<LeadHandlingSettings> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      const rows = await this.readIn(tx, orgId, ['uncontacted']);
      return { uncontacted: this.uncontactedOf(rows.get('uncontacted')) };
    });
  }

  async updateUncontacted(input: UpdateUncontactedSettingsInput): Promise<UncontactedSettings> {
    const { rowVersion, ...values } = input;
    const row = await this.save('uncontacted', values, rowVersion, (c) =>
      mergeUncontactedSettings(c),
    );
    return this.uncontactedOf(row);
  }

  private uncontactedOf(row: SectionRow | undefined): UncontactedSettings {
    return {
      ...mergeUncontactedSettings(row?.config),
      rowVersion: row?.rowVersion ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * First save has no `rowVersion` and inserts; every later save must carry the current one. A mismatch either way is the same 409
   * the screen already handles (it reloads and shows the other person's values).
   */
  private async save(
    section: LeadHandlingSection,
    values: unknown,
    rowVersion: number | undefined,
    merge: (config: unknown) => unknown,
  ): Promise<SectionRow> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = (await this.readIn(tx, ctx.orgId, [section])).get(section);
      if ((before === undefined) !== (rowVersion === undefined)) {
        throw AppError.rowVersionConflict('Lead handling settings');
      }
      const json = JSON.stringify(values);
      const res = before
        ? await tx.execute(sql`
            UPDATE lead_followup_settings SET config = ${json}::jsonb, updated_by = ${ctx.userId}
            WHERE org_id = ${ctx.orgId} AND section = ${section} AND row_version = ${rowVersion!}
            RETURNING section, config, row_version, updated_at`)
        : await tx.execute(sql`
            INSERT INTO lead_followup_settings (org_id, section, config, updated_by)
            VALUES (${ctx.orgId}, ${section}, ${json}::jsonb, ${ctx.userId})
            ON CONFLICT (org_id, section) DO NOTHING
            RETURNING section, config, row_version, updated_at`);
      const r = res.rows[0] as Record<string, unknown> | undefined;
      if (!r) throw AppError.rowVersionConflict('Lead handling settings');
      const after: SectionRow = {
        section,
        config: r.config,
        rowVersion: Number(r.row_version),
        updatedAt: new Date(r.updated_at as string),
      };
      const delta = settingsDelta(merge(before?.config), merge(after.config));
      await this.audit.record(tx, {
        module: LEAD_HANDLING_MODULE,
        recordId: ctx.orgId,
        action: before ? 'update' : 'insert',
        delta: { section: { old: null, new: section }, ...delta },
      });
      await this.outbox.emit(tx, {
        aggregateModule: LEAD_HANDLING_MODULE,
        aggregateId: ctx.orgId,
        eventType: 'lead_handling.settings_changed',
        payload: { section, changed: Object.keys(delta) },
      });
      return after;
    });
  }
}
