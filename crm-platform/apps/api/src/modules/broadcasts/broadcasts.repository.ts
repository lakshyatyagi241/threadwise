import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { hasGrantedConsentSql } from '../contact-consent';
import { PERMANENT_FAILURE_SQL_REGEX } from './retry-policy';

/** `IN (...)` lists are chunked so a 100k-contact audience never builds one giant statement. */
const CHUNK = 2_000;
const chunks = <T>(items: readonly T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};
const list = (values: ReadonlyArray<string | number>, cast: string) =>
  sql.join(
    values.map((v) => sql`${v}::${sql.raw(cast)}`),
    sql`, `,
  );

export interface BroadcastRow {
  id: number;
  uuid: string;
  name: string;
  status: string;
  provider: string | null;
  deviceId: number | null;
  templateUuid: string | null;
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
  updatedAt: Date;
}

interface Raw {
  id: number | string;
  uuid: string;
  name: string;
  status: string;
  provider: string | null;
  device_id: number | string | null;
  template_uuid: string | null;
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
  updated_at: Date | string;
}

const toRow = (r: Raw): BroadcastRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  name: r.name,
  status: r.status,
  provider: r.provider,
  deviceId: r.device_id === null ? null : Number(r.device_id),
  templateUuid: r.template_uuid,
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
  updatedAt: new Date(r.updated_at),
});

export interface NewBroadcast {
  userId: number | null;
  provider: string;
  deviceId: number | null;
  templateId: number;
  templateOverrides: object | null;
  name: string;
  timezone: string;
  status: 'scheduled' | 'processing';
  scheduledAt: Date;
  totalRecipients: number;
}

/**
 * Data access for broadcasts and their recipient rows (TW-BCAST-010, 015).
 * Every statement names `org_id`; row-level security backs it up.
 */
@Injectable()
export class BroadcastsRepository {
  /** Live row count: Reference's `broadcast_limit` check counts the rows that exist now. */
  async count(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM broadcasts WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  /**
   * Ids of the contacts named directly, in the order they were sent. Ids of another organization (or unknown ones) are
   * dropped: validation upstream only proves a uuid is well formed.
   */
  async contactIdsByUuid(tx: Tx, orgId: number, uuids: readonly string[]): Promise<number[]> {
    const byUuid = new Map<string, number>();
    for (const part of chunks(uuids)) {
      const res = await tx.execute(
        sql`SELECT id, uuid FROM contacts WHERE org_id = ${orgId} AND uuid IN (${list(part, 'uuid')})`,
      );
      for (const r of res.rows as Array<{ id: number | string; uuid: string }>)
        byUuid.set(r.uuid, Number(r.id));
    }
    return uuids.flatMap((u) => (byUuid.has(u) ? [byUuid.get(u)!] : []));
  }

  /** Members of the given groups of this organization, ascending by contact id. */
  async groupMemberIds(tx: Tx, orgId: number, groupUuids: readonly string[]): Promise<number[]> {
    if (groupUuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT DISTINCT m.contact_id AS id
      FROM contact_group_members m
      JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id
      WHERE m.org_id = ${orgId} AND g.uuid IN (${list(groupUuids, 'uuid')})
      ORDER BY m.contact_id`);
    return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
  }

  /** Contacts carrying any of the given tags of this organization, ascending by contact id. */
  async tagMemberIds(tx: Tx, orgId: number, tagUuids: readonly string[]): Promise<number[]> {
    if (tagUuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT DISTINCT ct.contact_id AS id
      FROM contact_tags ct
      JOIN tags t ON t.org_id = ct.org_id AND t.id = ct.tag_id
      WHERE ct.org_id = ${orgId} AND t.uuid IN (${list(tagUuids, 'uuid')})
      ORDER BY ct.contact_id`);
    return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
  }

  /**
   * Of these contact ids, the ones that may be messaged: they exist in this organization, are not archived, and have
   * not opted out (STOP keyword or manual unsubscribe). Returned as a set; the caller keeps its own order.
   */
  async sendableIds(
    tx: Tx,
    orgId: number,
    ids: readonly number[],
    requireConsent = false,
  ): Promise<Set<number>> {
    const ok = new Set<number>();
    for (const part of chunks(ids)) {
      // With the workspace switch "Require recorded consent for marketing sends" ON, a contact also needs a recorded grant.
      const res = await tx.execute(sql`
        SELECT c.id FROM contacts c
        WHERE c.org_id = ${orgId} AND c.id IN (${list(part, 'bigint')}) AND NOT c.is_unsubscribed AND NOT c.is_archived
          ${requireConsent ? sql`AND ${hasGrantedConsentSql('c')}` : sql``}`);
      for (const r of res.rows as Array<{ id: number | string }>) ok.add(Number(r.id));
    }
    return ok;
  }

  async insert(tx: Tx, orgId: number, v: NewBroadcast): Promise<BroadcastRow> {
    const res = await tx.execute(sql`
      WITH ins AS (
        INSERT INTO broadcasts (org_id, user_id, provider, device_id, template_id, template_overrides, name, timezone,
                                status, scheduled_at, total_recipients)
        VALUES (${orgId}, ${v.userId}, ${v.provider}, ${v.deviceId}, ${v.templateId},
                ${v.templateOverrides === null ? null : JSON.stringify(v.templateOverrides)}::jsonb,
                ${v.name}, ${v.timezone}, ${v.status}, ${v.scheduledAt.toISOString()}::timestamptz, ${v.totalRecipients})
        RETURNING *
      )
      SELECT ins.*, t.uuid AS template_uuid
      FROM ins LEFT JOIN wa_templates t ON t.org_id = ins.org_id AND t.id = ins.template_id`);
    return toRow(res.rows[0] as unknown as Raw);
  }

  /** One `pending` recipient row per contact (Reference attached them even without a usable phone). */
  async insertRecipients(
    tx: Tx,
    orgId: number,
    broadcastId: number,
    contactIds: readonly number[],
  ): Promise<void> {
    for (const part of chunks(contactIds, 1_000)) {
      await tx.execute(sql`
        INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status)
        VALUES ${sql.join(
          part.map((id) => sql`(${orgId}, ${broadcastId}, ${id}, 'pending')`),
          sql`, `,
        )}`);
    }
  }

  /** The row, locked, so a concurrent retry, delete or run waits for this decision. */
  async lock(tx: Tx, orgId: number, uuid: string) {
    const res = await tx.execute(sql`
      SELECT id, status, provider FROM broadcasts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`);
    const r = res.rows[0] as
      { id: number | string; status: string; provider: string | null } | undefined;
    return r ? { id: Number(r.id), status: r.status, provider: r.provider } : undefined;
  }

  /** Recipients go with it (foreign key cascade). */
  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM broadcasts WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async failedCount(tx: Tx, orgId: number, id: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM broadcast_contacts
      WHERE org_id = ${orgId} AND broadcast_id = ${id} AND status IN ('failed', 'undelivered')`);
    return Number((res.rows[0] as { n: number }).n);
  }

  /** Failed recipients back to `pending`, error and provider id cleared. `skipPermanent` leaves the ones a retry cannot fix. */
  async resetFailed(tx: Tx, orgId: number, id: number, skipPermanent: boolean): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE broadcast_contacts SET status = 'pending', error_message = NULL, whatsapp_message_id = NULL
      WHERE org_id = ${orgId} AND broadcast_id = ${id} AND status IN ('failed', 'undelivered')
        ${skipPermanent ? sql`AND (error_message IS NULL OR error_message !~ ${PERMANENT_FAILURE_SQL_REGEX})` : sql``}
      RETURNING id`);
    return res.rows.length;
  }

  /** Make the broadcast due again: the sender queues it on its next pass. */
  async reopen(
    tx: Tx,
    orgId: number,
    id: number,
    attempts: { sendAttempts: number; delaySeconds: number } | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE broadcasts SET node_schedule_id = NULL,
        send_attempts = ${attempts ? attempts.sendAttempts : 0},
        next_attempt_at = ${attempts ? sql`now() + ${`${attempts.delaySeconds} seconds`}::interval` : sql`NULL`}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
