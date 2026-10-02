import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/** A `wa_provider_configs` row of provider 'waba', as it comes out of the database. */
export interface WabaRow {
  id: number;
  uuid: string;
  status: string;
  is_primary: boolean;
  phone_number: string | null;
  display_label: string | null;
  credentials_json: string | null;
  meta_json: Record<string, unknown> | null;
  connected_at: Date | null;
  last_health_at: Date | null;
  row_version: number;
}

const COLUMNS = sql.raw(
  'id, uuid, status, is_primary, phone_number, display_label, credentials_json, meta_json, connected_at, last_health_at, row_version',
);

const toRow = (r: Record<string, unknown>): WabaRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  status: String(r.status),
  is_primary: Boolean(r.is_primary),
  phone_number: (r.phone_number as string | null) ?? null,
  display_label: (r.display_label as string | null) ?? null,
  credentials_json: (r.credentials_json as string | null) ?? null,
  meta_json: (r.meta_json as Record<string, unknown> | null) ?? null,
  connected_at: r.connected_at ? new Date(r.connected_at as string) : null,
  last_health_at: r.last_health_at ? new Date(r.last_health_at as string) : null,
  row_version: Number(r.row_version),
});

export interface NewWabaRow {
  status: string;
  isPrimary: boolean;
  phoneNumber: string | null;
  displayLabel: string | null;
  credentialsJson: string | null;
  metaJson: Record<string, unknown>;
  connectedAt: Date | null;
}

export interface WabaRowPatch {
  status?: string;
  isPrimary?: boolean;
  phoneNumber?: string | null;
  displayLabel?: string | null;
  credentialsJson?: string | null;
  /** Merged into the stored meta_json (a key set to null is kept as null; use `dropMeta` to remove one). */
  metaPatch?: Record<string, unknown>;
  connectedAt?: Date | null;
  lastHealthAt?: Date | null;
}

/** Tenant-scoped access to connected WhatsApp numbers. Every method runs inside the caller's `DatabaseService.tx`. */
@Injectable()
export class WabaConnectionsRepository {
  async list(tx: Tx, orgId: number): Promise<WabaRow[]> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'waba'
      ORDER BY is_primary DESC, connected_at DESC NULLS LAST, id DESC`);
    return res.rows.map(toRow);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<WabaRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'waba' AND uuid = ${uuid}::uuid`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<WabaRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'waba' AND id = ${id}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  /** The row for this exact WABA and phone, so reconnecting reuses it instead of adding a second card. */
  async findByIds(
    tx: Tx,
    orgId: number,
    wabaId: string,
    phoneNumberId: string,
  ): Promise<WabaRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'waba'
        AND meta_json ->> 'waba_id' = ${wabaId} AND meta_json ->> 'phone_number_id' = ${phoneNumberId}
      ORDER BY id DESC LIMIT 1`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async countConnected(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = 'waba' AND status = 'connected'`);
    return Number((res.rows[0] as { n: number }).n);
  }

  async hasAnyWaba(tx: Tx, orgId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'waba' LIMIT 1`);
    return res.rows.length > 0;
  }

  async insert(tx: Tx, orgId: number, v: NewWabaRow): Promise<WabaRow> {
    const res = await tx.execute(sql`
      INSERT INTO wa_provider_configs
        (org_id, provider, status, is_primary, phone_number, display_label, credentials_json, meta_json, connected_at, last_health_at)
      VALUES
        (${orgId}, 'waba', ${v.status}, ${v.isPrimary}, ${v.phoneNumber}, ${v.displayLabel}, ${v.credentialsJson},
         ${JSON.stringify(v.metaJson)}::jsonb, ${v.connectedAt}, ${v.connectedAt})
      RETURNING ${COLUMNS}`);
    return toRow(res.rows[0] as Record<string, unknown>);
  }

  /** Optimistic when `expectedVersion` is given; a stale version updates nothing and returns null. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    p: WabaRowPatch,
    expectedVersion?: number,
  ): Promise<WabaRow | null> {
    const sets = [];
    if (p.status !== undefined) sets.push(sql`status = ${p.status}`);
    if (p.isPrimary !== undefined) sets.push(sql`is_primary = ${p.isPrimary}`);
    if (p.phoneNumber !== undefined) sets.push(sql`phone_number = ${p.phoneNumber}`);
    if (p.displayLabel !== undefined) sets.push(sql`display_label = ${p.displayLabel}`);
    if (p.credentialsJson !== undefined) sets.push(sql`credentials_json = ${p.credentialsJson}`);
    if (p.metaPatch)
      sets.push(
        sql`meta_json = coalesce(meta_json, '{}'::jsonb) || ${JSON.stringify(p.metaPatch)}::jsonb`,
      );
    if (p.connectedAt !== undefined) sets.push(sql`connected_at = ${p.connectedAt}`);
    if (p.lastHealthAt !== undefined) sets.push(sql`last_health_at = ${p.lastHealthAt}`);
    if (sets.length === 0) return this.findById(tx, orgId, id);
    const version =
      expectedVersion === undefined ? sql`` : sql` AND row_version = ${expectedVersion}`;
    const res = await tx.execute(sql`
      UPDATE wa_provider_configs SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND provider = 'waba' AND id = ${id}${version}
      RETURNING ${COLUMNS}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  /** The workspace has one default sender across every engine, so promoting one demotes the others of any provider. */
  async demoteOthers(tx: Tx, orgId: number, exceptId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_provider_configs SET is_primary = false
      WHERE org_id = ${orgId} AND id <> ${exceptId} AND is_primary`);
  }

  /** After the primary goes away: the newest connected WABA number takes over; nothing is promoted when none is connected. */
  async promoteNext(tx: Tx, orgId: number): Promise<number | null> {
    const res = await tx.execute(sql`
      UPDATE wa_provider_configs SET is_primary = true
      WHERE org_id = ${orgId} AND id = (
        SELECT id FROM wa_provider_configs
        WHERE org_id = ${orgId} AND provider = 'waba' AND status = 'connected'
        ORDER BY connected_at DESC NULLS LAST, id DESC LIMIT 1)
      RETURNING id`);
    return res.rows[0] ? Number((res.rows[0] as { id: number }).id) : null;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      DELETE FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'waba' AND id = ${id} RETURNING id`);
    return res.rows.length > 0;
  }
}
