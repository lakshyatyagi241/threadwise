import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreKind } from './mirror-rules';

/** One automation mapped to a template (WD-ECOM-009, 033). */
export interface EventConfig {
  id: number;
  eventType: string;
  isActive: boolean;
  templateId: number | null;
  varMap: string[] | null;
  sendTo: 'customer' | 'admin' | 'both';
  adminNumber: string | null;
  delaySeconds: number;
}

/** An automation row as the screen shows it, with its template's name and how often its event was logged. */
export interface AutomationRow extends EventConfig {
  templateUuid: string | null;
  templateName: string | null;
}

export type LogStatus = 'received' | 'processed' | 'skipped' | 'sent' | 'failed';
export interface LogRef {
  id: number;
  createdAt: Date;
}

// Table names are fixed by the store kind, never taken from input.
const tables = (kind: StoreKind): { events: SQL; logs: SQL } =>
  kind === 'shopify'
    ? { events: sql.raw('shopify_integration_events'), logs: sql.raw('shopify_integration_logs') }
    : {
        events: sql.raw('woocommerce_integration_events'),
        logs: sql.raw('woocommerce_integration_logs'),
      };

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;

const toConfig = (r: Record<string, unknown>): EventConfig => ({
  id: Number(r.id),
  eventType: r.event_type as string,
  isActive: r.is_active === true,
  templateId: r.template_id === null ? null : Number(r.template_id),
  varMap: strings(r.var_map),
  sendTo: r.send_to === 'admin' || r.send_to === 'both' ? r.send_to : 'customer',
  adminNumber: typeof r.admin_number === 'string' ? r.admin_number : null,
  delaySeconds: Number(r.delay_seconds ?? 0),
});

/** The automation mapping and the activity log of a store, always inside the caller's tenant transaction. */
@Injectable()
export class EventsRepository {
  async find(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeId: number,
    eventType: string,
  ): Promise<EventConfig | undefined> {
    const t = tables(kind);
    const res = await tx.execute(sql`
      SELECT id, event_type, is_active, template_id, var_map, send_to, admin_number, delay_seconds
      FROM ${t.events}
      WHERE org_id = ${orgId} AND integration_id = ${storeId} AND event_type = ${eventType}`);
    const r = res.rows[0] as Record<string, unknown> | undefined;
    return r ? toConfig(r) : undefined;
  }

  async list(tx: Tx, orgId: number, kind: StoreKind, storeId: number): Promise<AutomationRow[]> {
    const t = tables(kind);
    const res = await tx.execute(sql`
      SELECT e.id, e.event_type, e.is_active, e.template_id, e.var_map, e.send_to, e.admin_number, e.delay_seconds,
             w.uuid AS template_uuid, w.template_name
      FROM ${t.events} e
      LEFT JOIN wa_templates w ON w.org_id = e.org_id AND w.id = e.template_id
      WHERE e.org_id = ${orgId} AND e.integration_id = ${storeId}`);
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      ...toConfig(r),
      templateUuid: typeof r.template_uuid === 'string' ? r.template_uuid : null,
      templateName: typeof r.template_name === 'string' ? r.template_name : null,
    }));
  }

  /** The active automations of a store among these event types that have a template, ordered by event type. */
  async activeAmong(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeId: number,
    types: readonly string[],
  ): Promise<EventConfig[]> {
    const t = tables(kind);
    const res = await tx.execute(sql`
      SELECT id, event_type, is_active, template_id, var_map, send_to, admin_number, delay_seconds
      FROM ${t.events}
      WHERE org_id = ${orgId} AND integration_id = ${storeId} AND is_active AND template_id IS NOT NULL
        AND event_type IN (${sql.join(
          types.map((x) => sql`${x}`),
          sql`, `,
        )})
      ORDER BY event_type`);
    return (res.rows as Array<Record<string, unknown>>).map(toConfig);
  }

  /** Is there a log row of this event for this recipient within the last `days` days? */
  async recentFor(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeId: number,
    eventType: string,
    recipient: string,
    days: number,
  ): Promise<boolean> {
    const t = tables(kind);
    const res = await tx.execute(sql`
      SELECT 1 FROM ${t.logs}
      WHERE org_id = ${orgId} AND integration_id = ${storeId} AND event_type = ${eventType} AND recipient = ${recipient}
        AND created_at >= now() - make_interval(days => ${days}) LIMIT 1`);
    return res.rows.length > 0;
  }

  /** Deliveries logged per event type. */
  async fired(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeId: number,
  ): Promise<Map<string, number>> {
    const t = tables(kind);
    const res = await tx.execute(sql`
      SELECT event_type, count(*)::int AS n FROM ${t.logs}
      WHERE org_id = ${orgId} AND integration_id = ${storeId} GROUP BY event_type`);
    return new Map(
      (res.rows as Array<{ event_type: string; n: number }>).map((r) => [
        r.event_type,
        Number(r.n),
      ]),
    );
  }

  /** Creates or updates the automation of one event (unique per store and event). */
  async upsert(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeId: number,
    c: Omit<EventConfig, 'id'>,
  ): Promise<void> {
    const t = tables(kind);
    await tx.execute(sql`
      INSERT INTO ${t.events} (org_id, integration_id, event_type, is_active, template_id, var_map, send_to, admin_number, delay_seconds)
      VALUES (${orgId}, ${storeId}, ${c.eventType}, ${c.isActive}, ${c.templateId},
              ${c.varMap ? JSON.stringify(c.varMap) : null}::jsonb, ${c.sendTo}, ${c.adminNumber}, ${c.delaySeconds})
      ON CONFLICT (org_id, integration_id, event_type) DO UPDATE SET
        is_active = EXCLUDED.is_active, template_id = EXCLUDED.template_id, var_map = EXCLUDED.var_map,
        send_to = EXCLUDED.send_to, admin_number = EXCLUDED.admin_number, delay_seconds = EXCLUDED.delay_seconds,
        updated_at = now(), row_version = ${t.events}.row_version + 1`);
  }

  /** Writes the log row of a delivery. Returns the key of the partitioned row (id and created_at) so it can be updated. */
  async log(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeId: number,
    row: {
      eventType: string;
      status: LogStatus;
      recipient?: string | null;
      payload?: unknown;
      error?: string | null;
    },
  ): Promise<LogRef> {
    const t = tables(kind);
    const res = await tx.execute(sql`
      INSERT INTO ${t.logs} (org_id, integration_id, event_type, status, recipient, payload, error)
      VALUES (${orgId}, ${storeId}, ${row.eventType}, ${row.status}, ${row.recipient ?? null},
              ${row.payload === undefined ? null : JSON.stringify(row.payload)}::jsonb, ${row.error ?? null})
      RETURNING id, created_at`);
    const r = res.rows[0] as { id: number | string; created_at: string | Date };
    return { id: Number(r.id), createdAt: new Date(r.created_at) };
  }

  async setLog(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    ref: LogRef,
    v: { status: LogStatus; recipient?: string | null; response?: unknown; error?: string | null },
  ): Promise<void> {
    const t = tables(kind);
    await tx.execute(sql`
      UPDATE ${t.logs}
      SET status = ${v.status},
          recipient = coalesce(${v.recipient ?? null}, recipient),
          response = coalesce(${v.response === undefined ? null : JSON.stringify(v.response)}::jsonb, response),
          error = ${v.error ?? null}
      WHERE org_id = ${orgId} AND id = ${ref.id} AND created_at = ${ref.createdAt.toISOString()}::timestamptz`);
  }
}
