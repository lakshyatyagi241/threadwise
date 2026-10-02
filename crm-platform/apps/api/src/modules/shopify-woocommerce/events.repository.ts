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
    if (!r) return undefined;
    const sendTo = r.send_to === 'admin' || r.send_to === 'both' ? r.send_to : 'customer';
    return {
      id: Number(r.id),
      eventType: r.event_type as string,
      isActive: r.is_active === true,
      templateId: r.template_id === null ? null : Number(r.template_id),
      varMap: strings(r.var_map),
      sendTo,
      adminNumber: typeof r.admin_number === 'string' ? r.admin_number : null,
      delaySeconds: Number(r.delay_seconds ?? 0),
    };
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
