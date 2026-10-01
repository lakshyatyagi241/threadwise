import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { ListBroadcastRecipientsQuery, ListBroadcastsQuery } from '@crm/contracts';
import { decodeCursor } from '../../common/pagination/cursor';
import type { HourCount } from './broadcast-stats';

const ISO = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export interface BroadcastReadRow {
  id: number;
  uuid: string;
  name: string;
  status: string;
  provider: string | null;
  deviceId: number | null;
  senderKey: string | null;
  templateId: number | null;
  templateUuid: string | null;
  templateName: string | null;
  timezone: string | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  totalRecipients: number;
  successCount: number;
  deliveredCount: number;
  readCount: number;
  clickedCount: number;
  failCount: number;
  rowVersion: number;
  createdAt: Date;
  createdAtIso: string;
  updatedAt: Date;
  messagesLog: unknown;
}

interface Raw {
  id: number | string;
  uuid: string;
  name: string;
  status: string;
  provider: string | null;
  device_id: number | string | null;
  sender_key: string | null;
  template_id: number | string | null;
  template_uuid: string | null;
  template_name: string | null;
  timezone: string | null;
  scheduled_at: Date | string | null;
  completed_at: Date | string | null;
  total_recipients: number;
  success_count: number;
  delivered_count: number;
  read_count: number;
  clicked_count: number;
  fail_count: number;
  row_version: number;
  created_at: Date | string;
  created_at_iso: string;
  updated_at: Date | string;
  messages_log: unknown;
}

const toRow = (r: Raw): BroadcastReadRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  name: r.name,
  status: r.status,
  provider: r.provider,
  deviceId: r.device_id === null ? null : Number(r.device_id),
  senderKey: r.sender_key,
  templateId: r.template_id === null ? null : Number(r.template_id),
  templateUuid: r.template_uuid,
  templateName: r.template_name,
  timezone: r.timezone,
  scheduledAt: r.scheduled_at ? new Date(r.scheduled_at) : null,
  completedAt: r.completed_at ? new Date(r.completed_at) : null,
  totalRecipients: Number(r.total_recipients),
  successCount: Number(r.success_count),
  deliveredCount: Number(r.delivered_count),
  readCount: Number(r.read_count),
  clickedCount: Number(r.clicked_count),
  failCount: Number(r.fail_count),
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at),
  createdAtIso: r.created_at_iso,
  updatedAt: new Date(r.updated_at),
  messagesLog: r.messages_log,
});

export interface RecipientReadRow {
  id: number;
  createdAt: Date;
  createdAtIso: string;
  contactUuid: string;
  contactName: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  countryCode: string | null;
  status: string;
  error: string | null;
  providerMessageId: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  updatedAt: Date;
  clicks: number;
  lastClickAt: Date | null;
}

/**
 * Read queries for the broadcast screens (TW-BCAST-001, 002, 030 to 036). Every statement names `org_id`.
 *
 * The sender key and label come from `devices` and `wa_provider_configs` with a read-only join (the same tables the sender
 * shim reads), until the device and WABA domains export a lookup.
 */
@Injectable()
export class BroadcastsReadRepository {
  private readonly select = sql`
    SELECT b.id, b.uuid, b.name, b.status, b.provider, b.device_id,
           CASE WHEN d.id IS NOT NULL THEN 'baileys:' || d.uuid::text
                WHEN c.id IS NOT NULL THEN c.provider || ':' || c.uuid::text END AS sender_key,
           b.template_id, t.uuid AS template_uuid, t.template_name, b.timezone, b.scheduled_at, b.completed_at,
           b.total_recipients, b.success_count, b.delivered_count, b.read_count, b.clicked_count, b.fail_count,
           b.row_version, b.created_at, to_char(b.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at_iso, b.updated_at, b.messages_log
    FROM broadcasts b
    LEFT JOIN wa_templates t ON t.org_id = b.org_id AND t.id = b.template_id
    LEFT JOIN devices d ON d.org_id = b.org_id AND d.id = b.device_id AND b.provider = 'baileys'
    LEFT JOIN wa_provider_configs c ON c.org_id = b.org_id AND c.id = b.device_id AND b.provider IN ('waba', 'twilio', 'sms')
  `;

  /** Newest first; `limit + 1` rows. The workspace's own broadcasts only: no engine scope (Reference hid a disabled engine's rows). */
  async list(tx: Tx, orgId: number, q: ListBroadcastsQuery): Promise<BroadcastReadRow[]> {
    const where = [sql`b.org_id = ${orgId}`];
    if (q.status) where.push(sql`b.status = ${q.status}`);
    const days = RANGE_DAYS[q.range];
    if (days) where.push(sql`b.created_at >= now() - ${`${days} days`}::interval`);
    if (q.q) where.push(sql`b.name ILIKE ${`%${escapeLike(q.q)}%`}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      where.push(
        sql`(b.created_at, b.id) < (${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz, ${c.id}::bigint)`,
      );
    }
    const res = await tx.execute(sql`
      ${this.select} WHERE ${sql.join(where, sql` AND `)}
      ORDER BY b.created_at DESC, b.id DESC LIMIT ${q.limit + 1}`);
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<BroadcastReadRow | undefined> {
    const res = await tx.execute(
      sql`${this.select} WHERE b.org_id = ${orgId} AND b.uuid = ${uuid}::uuid`,
    );
    const row = (res.rows as unknown as Raw[])[0];
    return row ? toRow(row) : undefined;
  }

  /** Workspace-wide totals from the cached counters, status counts, and the recipient states the tiles call queued and processing. */
  async summary(tx: Tx, orgId: number) {
    const totals = await tx.execute(sql`
      SELECT count(*)::int AS total, coalesce(sum(total_recipients), 0)::int AS recipients,
             coalesce(sum(success_count), 0)::int AS sent, coalesce(sum(delivered_count), 0)::int AS delivered,
             coalesce(sum(read_count), 0)::int AS read, coalesce(sum(fail_count), 0)::int AS failed,
             coalesce(sum(clicked_count), 0)::int AS clicked
      FROM broadcasts WHERE org_id = ${orgId}`);
    const byStatus = await tx.execute(sql`
      SELECT status, count(*)::int AS n FROM broadcasts WHERE org_id = ${orgId} GROUP BY status`);
    const rec = await tx.execute(sql`
      SELECT count(*) FILTER (WHERE status = 'pending')::int AS queued,
             count(*) FILTER (WHERE status IN ('processing', 'sent'))::int AS processing
      FROM broadcast_contacts WHERE org_id = ${orgId}`);
    return {
      totals: totals.rows[0] as unknown as Record<
        'total' | 'recipients' | 'sent' | 'delivered' | 'read' | 'failed' | 'clicked',
        number
      >,
      byStatus: byStatus.rows as unknown as Array<{ status: string; n: number }>,
      recipientStates: rec.rows[0] as unknown as { queued: number; processing: number },
    };
  }

  async template(tx: Tx, orgId: number, templateId: number) {
    const res = await tx.execute(sql`
      SELECT uuid, template_name, coalesce(meta_category, category, 'utility') AS category, template_type, language,
             header, template_body, footer, buttons
      FROM wa_templates WHERE org_id = ${orgId} AND id = ${templateId}`);
    return res.rows[0] as unknown as
      | {
          uuid: string;
          template_name: string;
          category: string;
          template_type: string;
          language: string;
          header: string | null;
          template_body: string;
          footer: string | null;
          buttons: unknown;
        }
      | undefined;
  }

  /** The number this broadcast sends from: the row it names. */
  async sender(tx: Tx, orgId: number, provider: string | null, deviceId: number | null) {
    if (deviceId === null) return undefined;
    const res =
      provider === 'baileys'
        ? await tx.execute(sql`
            SELECT coalesce(nullif(device_name, ''), phone_number) AS label, country_code, phone_number AS phone
            FROM devices WHERE org_id = ${orgId} AND id = ${deviceId}`)
        : await tx.execute(sql`
            SELECT coalesce(nullif(display_label, ''), phone_number) AS label, NULL AS country_code, phone_number AS phone
            FROM wa_provider_configs WHERE org_id = ${orgId} AND id = ${deviceId}`);
    return res.rows[0] as unknown as
      { label: string | null; country_code: string | null; phone: string | null } | undefined;
  }

  /** The creation hour and the sent, delivered and read events per hour, all in the broadcast's own zone. */
  async curveInputs(tx: Tx, orgId: number, broadcastId: number, createdAt: Date, zone: string) {
    const hour = (col: string) =>
      sql`SELECT to_char(date_trunc('hour', ${sql.raw(col)} AT TIME ZONE ${zone}), 'YYYY-MM-DD HH24') AS hour, count(*)::int AS n
          FROM broadcast_contacts WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND ${sql.raw(col)} IS NOT NULL
          GROUP BY 1`;
    const [sent, delivered, read, created] = await Promise.all([
      tx.execute(hour('sent_at')),
      tx.execute(hour('delivered_at')),
      tx.execute(hour('read_at')),
      tx.execute(
        sql`SELECT to_char(date_trunc('hour', ${createdAt.toISOString()}::timestamptz AT TIME ZONE ${zone}), 'YYYY-MM-DD HH24') AS hour`,
      ),
    ]);
    return {
      createdHour: (created.rows[0] as { hour: string }).hour,
      sent: sent.rows as unknown as HourCount[],
      delivered: delivered.rows as unknown as HourCount[],
      read: read.rows as unknown as HourCount[],
    };
  }

  /** Contacts who tapped any tracked link of the broadcast. */
  async clickedContacts(tx: Tx, orgId: number, broadcastId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(DISTINCT contact_id)::int AS n FROM wa_link_clicks
      WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND clicks > 0 AND contact_id IS NOT NULL`);
    return Number((res.rows[0] as { n: number }).n);
  }

  async failureReasons(tx: Tx, orgId: number, broadcastId: number) {
    const res = await tx.execute(sql`
      SELECT error_message AS reason, count(*)::int AS count FROM broadcast_contacts
      WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND status = 'failed' GROUP BY 1`);
    return res.rows as unknown as Array<{ reason: string | null; count: number }>;
  }

  /** Recipients, newest first, with the contact's name and number and the clicks on the broadcast's links. */
  async recipients(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    q: ListBroadcastRecipientsQuery,
  ): Promise<RecipientReadRow[]> {
    const where = [sql`bc.org_id = ${orgId}`, sql`bc.broadcast_id = ${broadcastId}`];
    if (q.status) where.push(sql`bc.status = ${q.status}`);
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      where.push(
        sql`(c.name ILIKE ${like} OR c.first_name ILIKE ${like} OR c.last_name ILIKE ${like} OR c.phone ILIKE ${like})`,
      );
    }
    if (q.cursor) {
      const cur = decodeCursor(q.cursor);
      where.push(
        sql`(bc.created_at, bc.id) < (${cur.createdAtIso ?? cur.createdAt.toISOString()}::timestamptz, ${cur.id}::bigint)`,
      );
    }
    const res = await tx.execute(sql`
      SELECT bc.id, bc.created_at, to_char(bc.created_at AT TIME ZONE 'UTC', ${ISO}) AS created_at_iso,
             c.uuid AS contact_uuid, c.name AS contact_name, c.first_name, c.last_name, c.phone, c.country_code,
             bc.status, bc.error_message AS error, bc.whatsapp_message_id AS provider_message_id,
             bc.sent_at, bc.delivered_at, bc.read_at, bc.updated_at,
             coalesce(k.clicks, 0)::int AS clicks, k.last_click_at
      FROM broadcast_contacts bc
      JOIN contacts c ON c.org_id = bc.org_id AND c.id = bc.contact_id
      LEFT JOIN (
        SELECT contact_id, sum(clicks) AS clicks, max(last_click_at) AS last_click_at
        FROM wa_link_clicks WHERE org_id = ${orgId} AND broadcast_id = ${broadcastId} AND clicks > 0 GROUP BY contact_id
      ) k ON k.contact_id = bc.contact_id
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY bc.created_at DESC, bc.id DESC LIMIT ${q.limit + 1}`);
    type R = Record<string, unknown>;
    const d = (v: unknown) => (v ? new Date(v as string) : null);
    return (res.rows as unknown as R[]).map((r) => ({
      id: Number(r.id),
      createdAt: new Date(r.created_at as string),
      createdAtIso: r.created_at_iso as string,
      contactUuid: r.contact_uuid as string,
      contactName: (r.contact_name as string) ?? null,
      firstName: (r.first_name as string) ?? null,
      lastName: (r.last_name as string) ?? null,
      phone: (r.phone as string) ?? null,
      countryCode: (r.country_code as string) ?? null,
      status: r.status as string,
      error: (r.error as string) ?? null,
      providerMessageId: (r.provider_message_id as string) ?? null,
      sentAt: d(r.sent_at),
      deliveredAt: d(r.delivered_at),
      readAt: d(r.read_at),
      updatedAt: new Date(r.updated_at as string),
      clicks: Number(r.clicks),
      lastClickAt: d(r.last_click_at),
    }));
  }
}
