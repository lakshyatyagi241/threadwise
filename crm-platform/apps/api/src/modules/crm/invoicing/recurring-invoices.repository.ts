import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { ListRecurringInvoicesQuery, RecordScope, RecurringFrequency, RecurringMode, RecurringStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

export interface RecurringRow {
  id: number;
  uuid: string;
  createdAt: Date;
  createdAtIso: string;
  updatedAt: Date;
  name: string;
  status: RecurringStatus;
  frequency: RecurringFrequency;
  interval: number;
  startDate: string;
  endDate: string | null;
  maxRuns: number | null;
  mode: RecurringMode;
  sendChannel: string;
  template: Record<string, unknown>;
  contactId: number | null;
  contactUuid: string | null;
  contactName: string | null;
  ownerId: number | null;
  createdBy: number | null;
  nextIndex: number;
  nextRunDate: string | null;
  runCount: number;
  failureCount: number;
  lastRunAt: Date | null;
  rowVersion: number;
}

export interface RecurringRunRow {
  id: number;
  periodIndex: number;
  periodDate: string;
  status: 'created' | 'failed';
  invoiceUuid: string | null;
  invoiceNumber: string | null;
  error: string | null;
  createdAt: Date;
}

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const SELECT = sql`
  SELECT r.id, r.uuid, r.created_at, to_char(r.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso, r.updated_at, r.name,
         r.status, r.frequency, r.interval_n, to_char(r.start_date, 'YYYY-MM-DD') AS start_date,
         to_char(r.end_date, 'YYYY-MM-DD') AS end_date, r.max_runs, r.mode, r.send_channel, r.template, r.contact_id,
         c.uuid AS contact_uuid, c.name AS contact_name, r.owner_id, r.created_by, r.next_index,
         to_char(r.next_run_date, 'YYYY-MM-DD') AS next_run_date, r.run_count, r.failure_count, r.last_run_at, r.row_version
  FROM recurring_invoices r
  LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
`;

const toRow = (r: Raw): RecurringRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  createdAt: new Date(r.created_at as string),
  createdAtIso: r.created_at_iso as string,
  updatedAt: new Date(r.updated_at as string),
  name: r.name as string,
  status: r.status as RecurringStatus,
  frequency: r.frequency as RecurringFrequency,
  interval: Number(r.interval_n),
  startDate: r.start_date as string,
  endDate: s(r.end_date),
  maxRuns: n(r.max_runs),
  mode: r.mode as RecurringMode,
  sendChannel: r.send_channel as string,
  template: r.template as Record<string, unknown>,
  contactId: n(r.contact_id),
  contactUuid: s(r.contact_uuid),
  contactName: s(r.contact_name),
  ownerId: n(r.owner_id),
  createdBy: n(r.created_by),
  nextIndex: Number(r.next_index),
  nextRunDate: s(r.next_run_date),
  runCount: Number(r.run_count),
  failureCount: Number(r.failure_count),
  lastRunAt: r.last_run_at ? new Date(r.last_run_at as string) : null,
  rowVersion: Number(r.row_version),
});

/** A schedule's people are its owner and creator: same record-scope rule as an invoice. */
export function recurringScopeCondition(orgId: number, scope: RecordScope, actorUserId: number | null): SQL | undefined {
  if (scope === 'all') return undefined;
  if (!actorUserId) return sql`false`;
  const own = sql`(r.owner_id = ${actorUserId} OR r.created_by = ${actorUserId})`;
  if (scope === 'own') return own;
  const peers = sql`(SELECT tm2.user_id FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId})`;
  return sql`(${own} OR r.owner_id IN ${peers} OR r.created_by IN ${peers})`;
}

@Injectable()
export class RecurringInvoicesRepository {
  async list(tx: Tx, orgId: number, query: ListRecurringInvoicesQuery, scope: SQL | undefined): Promise<RecurringRow[]> {
    const conds: SQL[] = [sql`r.org_id = ${orgId}`];
    if (scope) conds.push(scope);
    if (query.status?.length) conds.push(sql`r.status IN (${sql.join(query.status.map((x) => sql`${x}`), sql`, `)})`);
    if (query.contactId)
      conds.push(sql`r.contact_id = (SELECT x.id FROM contacts x WHERE x.org_id = ${orgId} AND x.uuid = ${query.contactId}::uuid)`);
    if (query.cursor) {
      const cur = decodeCursor(query.cursor);
      conds.push(sql`(r.created_at, r.id) < (${cur.createdAtIso ?? cur.createdAt.toISOString()}::timestamptz, ${cur.id})`);
    }
    const res = await tx.execute(
      sql`${SELECT} WHERE ${sql.join(conds, sql` AND `)} ORDER BY r.created_at DESC, r.id DESC LIMIT ${query.limit + 1}`,
    );
    return (res.rows as Raw[]).map(toRow);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string, forUpdate = false): Promise<RecurringRow | undefined> {
    if (forUpdate)
      await tx.execute(sql`SELECT 1 FROM recurring_invoices WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`);
    const res = await tx.execute(sql`${SELECT} WHERE r.org_id = ${orgId} AND r.uuid = ${uuid}::uuid`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<RecurringRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE r.org_id = ${orgId} AND r.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async visible(tx: Tx, orgId: number, id: number, scope: SQL | undefined): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM recurring_invoices r WHERE r.org_id = ${orgId} AND r.id = ${id} ${scope ? sql`AND ${scope}` : sql``}`,
    );
    return res.rows.length > 0;
  }

  /** Locks one schedule for the runner; SKIP LOCKED so a second worker passes over a schedule that is being run. */
  async lockForRun(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM recurring_invoices WHERE org_id = ${orgId} AND id = ${id} FOR UPDATE SKIP LOCKED`,
    );
    return res.rows.length > 0;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      name: string;
      frequency: string;
      interval: number;
      startDate: string;
      endDate: string | null;
      maxRuns: number | null;
      mode: string;
      sendChannel: string;
      template: unknown;
      contactId: number | null;
      companyId: number | null;
      dealId: number | null;
      ownerId: number | null;
      createdBy: number | null;
      nextRunDate: string;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO recurring_invoices (org_id, name, frequency, interval_n, start_date, end_date, max_runs, mode, send_channel, template,
                                      contact_id, company_id, deal_id, owner_id, created_by, next_run_date)
      VALUES (${orgId}, ${v.name}, ${v.frequency}, ${v.interval}, ${v.startDate}::date, ${v.endDate}::date, ${v.maxRuns}, ${v.mode},
              ${v.sendChannel}, ${JSON.stringify(v.template)}::jsonb, ${v.contactId}, ${v.companyId}, ${v.dealId}, ${v.ownerId},
              ${v.createdBy}, ${v.nextRunDate}::date)
      RETURNING id
    `);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number | null,
    p: {
      name?: string;
      frequency?: string;
      interval?: number;
      endDate?: string | null;
      maxRuns?: number | null;
      mode?: string;
      sendChannel?: string;
      template?: unknown;
      contactId?: number | null;
      companyId?: number | null;
      dealId?: number | null;
      status?: string;
      nextIndex?: number;
      nextRunDate?: string | null;
    },
  ): Promise<boolean> {
    const sets: SQL[] = [];
    if (p.name !== undefined) sets.push(sql`name = ${p.name}`);
    if (p.frequency !== undefined) sets.push(sql`frequency = ${p.frequency}`);
    if (p.interval !== undefined) sets.push(sql`interval_n = ${p.interval}`);
    if (p.endDate !== undefined) sets.push(sql`end_date = ${p.endDate}::date`);
    if (p.maxRuns !== undefined) sets.push(sql`max_runs = ${p.maxRuns}`);
    if (p.mode !== undefined) sets.push(sql`mode = ${p.mode}`);
    if (p.sendChannel !== undefined) sets.push(sql`send_channel = ${p.sendChannel}`);
    if (p.template !== undefined) sets.push(sql`template = ${JSON.stringify(p.template)}::jsonb`);
    if (p.contactId !== undefined) sets.push(sql`contact_id = ${p.contactId}`);
    if (p.companyId !== undefined) sets.push(sql`company_id = ${p.companyId}`);
    if (p.dealId !== undefined) sets.push(sql`deal_id = ${p.dealId}`);
    if (p.status !== undefined) sets.push(sql`status = ${p.status}`);
    if (p.nextIndex !== undefined) sets.push(sql`next_index = ${p.nextIndex}`);
    if (p.nextRunDate !== undefined) sets.push(sql`next_run_date = ${p.nextRunDate}::date`);
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE recurring_invoices SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} ${rowVersion !== null ? sql`AND row_version = ${rowVersion}` : sql``}
      RETURNING id
    `);
    return res.rows.length > 0;
  }

  /** Records progress after a period was generated (or failed): the counters and the next period move in the same statement. */
  async advance(
    tx: Tx,
    orgId: number,
    id: number,
    v: { nextIndex: number; nextRunDate: string | null; ok: boolean },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE recurring_invoices SET
        next_index = ${v.nextIndex}, next_run_date = ${v.nextRunDate}::date,
        status = CASE WHEN ${v.nextRunDate}::date IS NULL THEN 'ended' ELSE status END,
        run_count = run_count + ${v.ok ? 1 : 0}, failure_count = failure_count + ${v.ok ? 0 : 1}, last_run_at = now()
      WHERE org_id = ${orgId} AND id = ${id}
    `);
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM recurring_invoices WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The idempotency claim: true when this call is the one that owns the period. */
  async claimRun(tx: Tx, orgId: number, recurringId: number, periodIndex: number, periodDate: string): Promise<number | null> {
    const res = await tx.execute(sql`
      INSERT INTO recurring_invoice_runs (org_id, recurring_id, period_index, period_date, status)
      VALUES (${orgId}, ${recurringId}, ${periodIndex}, ${periodDate}::date, 'failed')
      ON CONFLICT (org_id, recurring_id, period_index) DO NOTHING
      RETURNING id
    `);
    const r = (res.rows as Raw[])[0];
    return r ? Number(r.id) : null;
  }

  async finishRun(tx: Tx, orgId: number, runId: number, v: { invoiceId: number | null; error: string | null }): Promise<void> {
    await tx.execute(sql`
      UPDATE recurring_invoice_runs SET status = ${v.error === null ? 'created' : 'failed'}, invoice_id = ${v.invoiceId}, error = ${v.error}
      WHERE org_id = ${orgId} AND id = ${runId}
    `);
  }

  async runs(tx: Tx, orgId: number, recurringId: number, limit: number, beforeIndex?: number): Promise<RecurringRunRow[]> {
    const res = await tx.execute(sql`
      SELECT u.id, u.period_index, to_char(u.period_date, 'YYYY-MM-DD') AS period_date, u.status, i.uuid AS invoice_uuid,
             i.invoice_number, u.error, u.created_at
      FROM recurring_invoice_runs u LEFT JOIN invoices i ON i.org_id = u.org_id AND i.id = u.invoice_id
      WHERE u.org_id = ${orgId} AND u.recurring_id = ${recurringId} ${beforeIndex !== undefined ? sql`AND u.period_index < ${beforeIndex}` : sql``}
      ORDER BY u.period_index DESC LIMIT ${limit + 1}
    `);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      periodIndex: Number(r.period_index),
      periodDate: r.period_date as string,
      status: r.status as 'created' | 'failed',
      invoiceUuid: s(r.invoice_uuid),
      invoiceNumber: s(r.invoice_number),
      error: s(r.error),
      createdAt: new Date(r.created_at as string),
    }));
  }

  /** The highest period index that already has a run (-1 when none): a changed schedule never goes back over it. */
  async maxRunIndex(tx: Tx, orgId: number, recurringId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT coalesce(max(period_index), -1) AS m FROM recurring_invoice_runs WHERE org_id = ${orgId} AND recurring_id = ${recurringId}`,
    );
    return Number((res.rows[0] as { m: number | string }).m);
  }

  async tagInvoice(tx: Tx, orgId: number, invoiceId: number, recurringId: number): Promise<void> {
    await tx.execute(sql`UPDATE invoices SET recurring_id = ${recurringId} WHERE org_id = ${orgId} AND id = ${invoiceId}`);
  }

  /** Cross-tenant claim for the worker (privileged transaction): schedules whose next date has come in their workspace's calendar. */
  async dueAcrossTenants(tx: Tx, limit: number): Promise<Array<{ orgId: number; id: number }>> {
    const res = await tx.execute(sql`
      SELECT r.org_id, r.id FROM recurring_invoices r JOIN organizations o ON o.id = r.org_id
      WHERE r.status = 'active' AND r.next_run_date IS NOT NULL
        AND r.next_run_date <= (now() AT TIME ZONE coalesce(
              (SELECT z.name FROM pg_timezone_names z WHERE z.name = o.settings ->> 'timezone'), 'UTC'))::date
      ORDER BY r.next_run_date, r.id LIMIT ${limit}
    `);
    return (res.rows as Raw[]).map((r) => ({ orgId: Number(r.org_id), id: Number(r.id) }));
  }
}
