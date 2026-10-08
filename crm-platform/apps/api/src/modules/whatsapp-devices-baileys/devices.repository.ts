import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { ERROR_CODES, type ListDevicesQuery } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

/** A `devices` row with the names the screens show, as it comes out of the database. */
export interface DeviceRow {
  id: number;
  uuid: string;
  device_name: string;
  country_code: string | null;
  phone_number: string;
  phone_digits: string | null;
  region: string | null;
  active: boolean;
  activate_after_pairing: boolean;
  status: string;
  connection_state: string;
  state_reason: string | null;
  state_changed_at: Date | null;
  last_seen_at: Date | null;
  proxy_enabled: boolean;
  proxy_status: string | null;
  proxy_egress_ip: string | null;
  sent_24h: number;
  failed_24h: number;
  warmer_configured: boolean;
  created_at: Date;
  row_version: number;
  assigned_user_id: number | null;
  assignee_uuid: string | null;
  assignee_name: string | null;
  creator_uuid: string | null;
  creator_name: string | null;
}

const SELECT = sql.raw(`
  d.id, d.uuid, d.device_name, d.country_code, d.phone_number, d.phone_digits, d.region, d.active, d.activate_after_pairing,
  d.status, d.connection_state, d.state_reason, d.state_changed_at, d.last_seen_at,
  d.proxy_enabled, d.proxy_status, d.proxy_egress_ip, d.sent_24h, d.failed_24h,
  (d.warmer_config IS NOT NULL AND d.warmer_config <> 'null'::jsonb AND d.warmer_config <> '{}'::jsonb) AS warmer_configured,
  d.created_at, d.row_version, d.assigned_user_id,
  au.uuid AS assignee_uuid, au.full_name AS assignee_name, cu.uuid AS creator_uuid, cu.full_name AS creator_name`);

const FROM = sql.raw(`
  FROM devices d
  LEFT JOIN users au ON au.org_id = d.org_id AND au.id = d.assigned_user_id
  LEFT JOIN users cu ON cu.org_id = d.org_id AND cu.id = d.user_id`);

const toRow = (r: Record<string, unknown>): DeviceRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  device_name: String(r.device_name),
  country_code: (r.country_code as string | null) ?? null,
  phone_number: String(r.phone_number),
  phone_digits: (r.phone_digits as string | null) ?? null,
  region: (r.region as string | null) ?? null,
  active: Boolean(r.active),
  activate_after_pairing: Boolean(r.activate_after_pairing),
  status: String(r.status),
  connection_state: String(r.connection_state),
  state_reason: (r.state_reason as string | null) ?? null,
  state_changed_at: r.state_changed_at ? new Date(r.state_changed_at as string) : null,
  last_seen_at: r.last_seen_at ? new Date(r.last_seen_at as string) : null,
  proxy_enabled: Boolean(r.proxy_enabled),
  proxy_status: (r.proxy_status as string | null) ?? null,
  proxy_egress_ip: (r.proxy_egress_ip as string | null) ?? null,
  sent_24h: Number(r.sent_24h),
  failed_24h: Number(r.failed_24h),
  warmer_configured: Boolean(r.warmer_configured),
  created_at: new Date(r.created_at as string),
  row_version: Number(r.row_version),
  assigned_user_id: r.assigned_user_id == null ? null : Number(r.assigned_user_id),
  assignee_uuid: (r.assignee_uuid as string | null) ?? null,
  assignee_name: (r.assignee_name as string | null) ?? null,
  creator_uuid: (r.creator_uuid as string | null) ?? null,
  creator_name: (r.creator_name as string | null) ?? null,
});

/** `ILIKE` text for a search term: the term is literal, so `%`, `_` and the escape character itself are escaped. */
const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The list order is `active` first, then newest (WaDesk): the cursor is that pair. */
const encodeCursor = (r: { active: boolean; id: number }): string =>
  Buffer.from(`${r.active ? 1 : 0}|${r.id}`, 'utf8').toString('base64url');

function decodeCursor(raw: string): { active: boolean; id: number } {
  const [a, i] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const id = Number.parseInt(i ?? '', 10);
  if ((a !== '0' && a !== '1') || Number.isNaN(id)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
  return { active: a === '1', id };
}

export interface NewDevice {
  /** Chosen by the caller so the acknowledgement can name the device it led to. */
  uuid: string;
  userId: number;
  assignedUserId: number | null;
  name: string;
  countryCode: string;
  phone: string;
  phoneDigits: string;
  region: string;
  activateAfterPairing: boolean;
  consentId: number | null;
}

/** Tenant-scoped access to personal-number devices. Every method runs inside the caller's `DatabaseService.tx`. */
@Injectable()
export class DevicesRepository {
  async list(
    tx: Tx,
    orgId: number,
    q: ListDevicesQuery,
  ): Promise<{ rows: DeviceRow[]; hasMore: boolean; nextCursor: string | null }> {
    const where = [sql`d.org_id = ${orgId}`];
    if (q.state) where.push(sql`d.connection_state = ${q.state}`);
    if (q.status) where.push(sql`d.status = ${q.status}`);
    if (q.q) {
      const like = likePattern(q.q);
      where.push(
        sql`(d.device_name ILIKE ${like} OR d.phone_number ILIKE ${like} OR d.phone_digits ILIKE ${like})`,
      );
    }
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      where.push(sql`(d.active, d.id) < (${c.active}, ${c.id})`);
    }
    const res = await tx.execute(sql`
      SELECT ${SELECT} ${FROM}
       WHERE ${sql.join(where, sql` AND `)}
       ORDER BY d.active DESC, d.id DESC
       LIMIT ${q.limit + 1}`);
    const all = (res.rows as Array<Record<string, unknown>>).map(toRow);
    const hasMore = all.length > q.limit;
    const rows = hasMore ? all.slice(0, q.limit) : all;
    const last = rows[rows.length - 1];
    return {
      rows,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ active: last.active, id: last.id }) : null,
    };
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string, lock = false): Promise<DeviceRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SELECT} ${FROM}
       WHERE d.org_id = ${orgId} AND d.uuid = ${uuid}::uuid
       ${lock ? sql`FOR UPDATE OF d` : sql``}`);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? toRow(row) : null;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<DeviceRow | null> {
    const res = await tx.execute(
      sql`SELECT ${SELECT} ${FROM} WHERE d.org_id = ${orgId} AND d.id = ${id}`,
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? toRow(row) : null;
  }

  async count(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM devices WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  /** Saved session rows: 3 or more is a healthy session the runtime would restore. */
  async sessionRows(tx: Tx, orgId: number, deviceId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM device_auth_state WHERE org_id = ${orgId} AND device_id = ${deviceId}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  async deleteSession(tx: Tx, orgId: number, deviceId: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM device_auth_state WHERE org_id = ${orgId} AND device_id = ${deviceId}`,
    );
  }

  /** The id of another device of this workspace with the same number, for the duplicate refusal. */
  async findByDigits(
    tx: Tx,
    orgId: number,
    digits: string,
    exceptId?: number,
  ): Promise<{ id: number; uuid: string } | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid FROM devices
       WHERE org_id = ${orgId} AND phone_digits = ${digits} ${exceptId ? sql`AND id <> ${exceptId}` : sql``}
       LIMIT 1`);
    const row = res.rows[0] as { id: number | string; uuid: string } | undefined;
    return row ? { id: Number(row.id), uuid: row.uuid } : null;
  }

  /** A member of this workspace by uuid. Another workspace's user is invisible here (RLS plus the org predicate). */
  async memberByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; name: string } | null> {
    const res = await tx.execute(sql`
      SELECT id, full_name FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND status <> 'inactive'`);
    const row = res.rows[0] as { id: number | string; full_name: string } | undefined;
    return row ? { id: Number(row.id), name: row.full_name } : null;
  }

  async userName(tx: Tx, orgId: number, userId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT full_name FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    return (res.rows[0] as { full_name: string } | undefined)?.full_name ?? null;
  }

  async insert(tx: Tx, orgId: number, v: NewDevice): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO devices (org_id, uuid, user_id, assigned_user_id, device_name, country_code, phone_number, phone_digits, region,
                           activate_after_pairing, consent_id, status, connection_state, active)
      VALUES (${orgId}, ${v.uuid}::uuid, ${v.userId}, ${v.assignedUserId}, ${v.name}, ${v.countryCode}, ${v.phone}, ${v.phoneDigits}, ${v.region},
              ${v.activateAfterPairing}, ${v.consentId}, 'disconnected', 'created', false)
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** Writes the changed columns when `row_version` still matches; false means somebody else edited the row first. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    patch: {
      name?: string;
      region?: string | null;
      assignedUserId?: number | null;
      active?: boolean;
      countryCode?: string;
      phone?: string;
      phoneDigits?: string;
    },
  ): Promise<boolean> {
    const sets = [sql`row_version = row_version`];
    if (patch.name !== undefined) sets.push(sql`device_name = ${patch.name}`);
    if (patch.region !== undefined) sets.push(sql`region = ${patch.region}`);
    if (patch.assignedUserId !== undefined)
      sets.push(sql`assigned_user_id = ${patch.assignedUserId}`);
    if (patch.active !== undefined) sets.push(sql`active = ${patch.active}`);
    if (patch.countryCode !== undefined) sets.push(sql`country_code = ${patch.countryCode}`);
    if (patch.phone !== undefined) sets.push(sql`phone_number = ${patch.phone}`);
    if (patch.phoneDigits !== undefined) sets.push(sql`phone_digits = ${patch.phoneDigits}`);
    const res = await tx.execute(sql`
      UPDATE devices SET ${sql.join(sets, sql`, `)}
       WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING id`);
    return res.rows.length === 1;
  }

  /**
   * The API's one state write besides `created`: a disconnect that no worker answered. The saved session is removed in the same
   * transaction (so a worker that comes back cannot restore and reconnect it) and the row says what is true.
   */
  async markDisconnectedByUser(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE devices
         SET status = 'disconnected', connection_state = 'disconnected', state_reason = 'user', state_changed_at = now()
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM devices WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setConsent(tx: Tx, orgId: number, id: number, consentId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE devices SET consent_id = ${consentId} WHERE org_id = ${orgId} AND id = ${id} AND consent_id IS NULL`,
    );
  }

  /** The newest acknowledgement of this user for this version (or null). */
  async acknowledgementOf(
    tx: Tx,
    orgId: number,
    userId: number,
    version: string,
  ): Promise<{ id: number; acceptedAt: Date } | null> {
    const res = await tx.execute(sql`
      SELECT id, accepted_at FROM device_risk_acknowledgements
       WHERE org_id = ${orgId} AND user_id = ${userId} AND policy_version = ${version}
       ORDER BY id DESC LIMIT 1`);
    const row = res.rows[0] as { id: number | string; accepted_at: string } | undefined;
    return row ? { id: Number(row.id), acceptedAt: new Date(row.accepted_at) } : null;
  }

  async insertAcknowledgement(
    tx: Tx,
    orgId: number,
    v: {
      userId: number;
      userName: string;
      version: string;
      textSha256: string;
      locale: string;
      deviceUuid: string | null;
      userAgent: string | null;
      ipHash: string | null;
    },
  ): Promise<{ id: number; acceptedAt: Date }> {
    const res = await tx.execute(sql`
      INSERT INTO device_risk_acknowledgements (org_id, user_id, user_name, policy_version, text_sha256, locale, device_uuid, user_agent, ip_hash)
      VALUES (${orgId}, ${v.userId}, ${v.userName}, ${v.version}, ${v.textSha256}, ${v.locale}, ${v.deviceUuid}, ${v.userAgent}, ${v.ipHash})
      RETURNING id, accepted_at`);
    const row = res.rows[0] as { id: number | string; accepted_at: string };
    return { id: Number(row.id), acceptedAt: new Date(row.accepted_at) };
  }
}
