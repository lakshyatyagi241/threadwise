import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { OWNER_DELETED_GRACE_DAYS } from './lifecycle.policy';

/** One row of the lifecycle view: the org plus its reminder counters for the current cycle. */
export interface LifecycleRow {
  id: number;
  uuid: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  last_activity_at: Date;
  archived_at: Date | null;
  deleted_at: Date | null;
  archive_after_days: number | null;
  delete_after_days: number | null;
  retention_exempt: boolean;
  retention_exempt_reason: string | null;
  retention_exempt_until: Date | null;
  retention_exempt_by: string | null;
  legal_hold: boolean;
  exempt_by_plan: boolean;
  reminders_archive: number;
  reminders_delete: number;
  last_reminder_at: Date | null;
}

export interface LogInput {
  orgId: number;
  orgUuid: string;
  eventType: string;
  stage?: 'archive' | 'delete';
  reminderNo?: number;
  daysInactive?: number;
  actorType?: string;
  actorRef?: string | null;
  details?: Record<string, unknown>;
}

/**
 * All SQL for the lifecycle. Every method takes the caller's transaction —
 * which, for this module, is always a privileged one (it spans tenants).
 *
 * Reminder counters are computed in SQL against `organizations.last_activity_at`
 * rather than a JS Date: timestamptz carries microseconds, a JS Date does not,
 * and the cycle match has to be exact.
 */
@Injectable()
export class LifecycleRepository {
  private static readonly SELECT = sql`
    SELECT o.id, o.uuid, o.name, o.slug, o.status, o.plan, o.last_activity_at, o.archived_at, o.deleted_at,
           o.archive_after_days, o.delete_after_days, o.retention_exempt,
           o.retention_exempt_reason, o.retention_exempt_until, o.retention_exempt_by, o.legal_hold,
           EXISTS (
             SELECT 1 FROM org_plan_state ps
               LEFT JOIN plans pl ON pl.slug = o.plan AND pl.kind = 'plan'
              WHERE ps.org_id = o.id
                AND (ps.platform_owned
                     OR pl.is_custom_quote
                     OR (pl.id IS NOT NULL AND NOT (pl.is_free OR pl.amount = 0)
                         AND (ps.plan_ends_at IS NULL OR ps.plan_ends_at > now())))
           ) AS exempt_by_plan,
           COALESCE(r.archive_n, 0)::int AS reminders_archive,
           COALESCE(r.delete_n, 0)::int  AS reminders_delete,
           r.last_at AS last_reminder_at
      FROM organizations o
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE l.stage = 'archive') AS archive_n,
               count(*) FILTER (WHERE l.stage = 'delete')  AS delete_n,
               max(l.created_at) AS last_at
          FROM org_lifecycle_log l
         WHERE l.org_id = o.id
           AND l.event_type = 'reminder_sent'
           AND l.inactivity_cycle = o.last_activity_at
      ) r ON true`;

  async findByUuid(tx: Tx, uuid: string, lock = false): Promise<LifecycleRow | undefined> {
    const res = await tx.execute(
      sql`${LifecycleRepository.SELECT} WHERE o.uuid = ${uuid}::uuid ${
        lock ? sql`FOR UPDATE OF o` : sql``
      }`,
    );
    return res.rows[0] as unknown as LifecycleRow | undefined;
  }

  async findById(tx: Tx, id: number, lock = false): Promise<LifecycleRow | undefined> {
    const res = await tx.execute(
      sql`${LifecycleRepository.SELECT} WHERE o.id = ${id} ${
        lock ? sql`FOR UPDATE OF o SKIP LOCKED` : sql``
      }`,
    );
    return res.rows[0] as unknown as LifecycleRow | undefined;
  }

  /**
   * Next batch of orgs that could possibly need action. Cheap pre-filter only —
   * the pure policy decides. The 30-day floor is the earliest any reminder can
   * be due (minimum archive override 60 days, first lead 30).
   */
  async candidateIds(tx: Tx, afterId: number, limit: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT id FROM organizations
       WHERE id > ${afterId}
         AND legal_hold = false
         AND (
           -- idle workspaces: the cheap pre-filter, the policy decides
           (status IN ('active', 'archived')
            AND (retention_exempt = false
                 OR (retention_exempt_until IS NOT NULL AND retention_exempt_until <= now()))
            AND last_activity_at < now() - interval '30 days')
           -- deleted by their owner, past the grace period
           OR (status = 'deleted' AND deleted_at IS NOT NULL
               AND deleted_at < now() - make_interval(days => ${OWNER_DELETED_GRACE_DAYS}))
         )
       ORDER BY id
       LIMIT ${limit}`);
    return (res.rows as Array<{ id: number }>).map((r) => r.id);
  }

  async list(
    tx: Tx,
    f: {
      status?: string;
      minDaysInactive?: number;
      exempt?: boolean;
      limit: number;
      cursor?: { at: Date; id: number };
      asc: boolean;
    },
  ): Promise<LifecycleRow[]> {
    const where = [sql`true`];
    if (f.status) where.push(sql`o.status = ${f.status}`);
    if (f.minDaysInactive !== undefined) {
      where.push(sql`o.last_activity_at <= now() - make_interval(days => ${f.minDaysInactive})`);
    }
    if (f.exempt !== undefined) where.push(sql`o.retention_exempt = ${f.exempt}`);
    if (f.cursor) {
      where.push(
        f.asc
          ? sql`(o.last_activity_at, o.id) > (${f.cursor.at.toISOString()}::timestamptz, ${f.cursor.id})`
          : sql`(o.last_activity_at, o.id) < (${f.cursor.at.toISOString()}::timestamptz, ${f.cursor.id})`,
      );
    }
    // asc = oldest activity first, i.e. the most idle orgs on page one.
    const order = f.asc
      ? sql`o.last_activity_at ASC, o.id ASC`
      : sql`o.last_activity_at DESC, o.id DESC`;
    const res = await tx.execute(sql`${LifecycleRepository.SELECT}
      WHERE ${sql.join(where, sql` AND `)} ORDER BY ${order} LIMIT ${f.limit + 1}`);
    return res.rows as unknown as LifecycleRow[];
  }

  async writeLog(tx: Tx, e: LogInput): Promise<boolean> {
    const res = await tx.execute(sql`
      INSERT INTO org_lifecycle_log
        (org_id, org_uuid, event_type, stage, reminder_no, inactivity_cycle, days_inactive,
         actor_type, actor_ref, details)
      VALUES (${e.orgId}, ${e.orgUuid}::uuid, ${e.eventType}, ${e.stage ?? null}, ${e.reminderNo ?? null},
              (SELECT last_activity_at FROM organizations WHERE id = ${e.orgId}),
              ${e.daysInactive ?? null}, ${e.actorType ?? 'system'}, ${e.actorRef ?? null},
              ${JSON.stringify(e.details ?? {})}::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING id`);
    return res.rows.length > 0;
  }

  async log(tx: Tx, orgUuid: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const res = await tx.execute(sql`
      SELECT event_type, stage, reminder_no, days_inactive, actor_type, actor_ref, details, created_at
        FROM org_lifecycle_log WHERE org_uuid = ${orgUuid}::uuid
       ORDER BY created_at DESC, id DESC LIMIT ${limit}`);
    return res.rows as Array<Record<string, unknown>>;
  }

  /**
   * Message traffic is activity too (a workspace running automations with nobody logging in is not idle). Folds the newest message
   * time into the clock; returns true when it moved, so the caller re-reads and re-decides.
   */
  async foldInMessageActivity(tx: Tx, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE organizations o SET last_activity_at = m.at
        FROM (SELECT max(created_at) AS at FROM messages WHERE org_id = ${id}) m
       WHERE o.id = ${id} AND m.at IS NOT NULL AND m.at > o.last_activity_at
      RETURNING o.id`);
    return res.rows.length > 0;
  }

  /** Ends every live session of the workspace; returns their ids so the caller can drop them from the session cache after commit. */
  async revokeSessions(tx: Tx, id: number, reason: string): Promise<string[]> {
    const res = await tx.execute(sql`
      UPDATE auth_sessions SET revoked_at = now(), revoked_reason = ${reason}
       WHERE org_id = ${id} AND revoked_at IS NULL RETURNING uuid`);
    return (res.rows as unknown as Array<{ uuid: string }>).map((r) => r.uuid);
  }

  /** Who is told: the workspace owner and its active admins. */
  async recipients(tx: Tx, id: number): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT DISTINCT u.email::text AS email FROM users u
       WHERE u.org_id = ${id} AND u.status = 'active' AND (
         u.uuid::text = (SELECT settings->>'ownerUserId' FROM organizations WHERE id = ${id})
         OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
                     WHERE ur.org_id = u.org_id AND ur.user_id = u.id AND r.system_key = 'admin'))`);
    return (res.rows as unknown as Array<{ email: string }>).map((r) => r.email);
  }

  async archive(tx: Tx, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE organizations SET status = 'archived', archived_at = now(), updated_at = now()
       WHERE id = ${id} AND status = 'active'`);
  }

  /** Restore also restarts the inactivity clock: it opens a fresh reminder cycle. */
  async restore(tx: Tx, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE organizations
         SET status = 'active', archived_at = NULL, last_activity_at = now(), updated_at = now()
       WHERE id = ${id} AND status = 'archived'`);
  }

  async setPolicy(
    tx: Tx,
    id: number,
    p: { archiveAfterDays?: number | null; deleteAfterDays?: number | null },
  ): Promise<void> {
    if (p.archiveAfterDays !== undefined) {
      await tx.execute(
        sql`UPDATE organizations SET archive_after_days = ${p.archiveAfterDays}, updated_at = now() WHERE id = ${id}`,
      );
    }
    if (p.deleteAfterDays !== undefined) {
      await tx.execute(
        sql`UPDATE organizations SET delete_after_days = ${p.deleteAfterDays}, updated_at = now() WHERE id = ${id}`,
      );
    }
  }

  async setExempt(
    tx: Tx,
    id: number,
    v: { exempt: boolean; reason: string; until: Date | null; by: string },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE organizations
         SET retention_exempt = ${v.exempt},
             retention_exempt_reason = ${v.exempt ? v.reason : null},
             retention_exempt_until = ${v.exempt && v.until ? v.until.toISOString() : null}::timestamptz,
             retention_exempt_by = ${v.exempt ? v.by : null},
             retention_exempt_at = ${v.exempt ? sql`now()` : sql`NULL`},
             updated_at = now()
       WHERE id = ${id}`);
  }

  async setLegalHold(tx: Tx, id: number, hold: boolean): Promise<void> {
    await tx.execute(
      sql`UPDATE organizations SET legal_hold = ${hold}, updated_at = now() WHERE id = ${id}`,
    );
  }

  /**
   * The text columns that hold an object-store key or a file path, on any table that carries an `org_id`: found from the catalogue, not
   * a hand-kept list, so a table added later is covered without anyone remembering (`storage_key`, `media_key`, and `*_path` such as
   * `media_path`, `pdf_path`, `attachment_path`; `external_id_path` is a JSON path, not a file).
   */
  async fileKeyColumns(tx: Tx): Promise<Array<{ table: string; column: string }>> {
    const res = await tx.execute(sql`
      SELECT c.relname AS tbl, a.attname AS col
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
         AND a.attnum > 0 AND NOT a.attisdropped
         AND a.atttypid = 'text'::regtype
         AND (a.attname IN ('storage_key', 'media_key') OR (a.attname ~ '_path$' AND a.attname !~ '_id_path$'))
         AND EXISTS (SELECT 1 FROM pg_attribute o WHERE o.attrelid = c.oid AND o.attname = 'org_id' AND NOT o.attisdropped)
         AND c.relname NOT IN ('storage_purge_queue', 'org_lifecycle_log')
       ORDER BY c.relname, a.attname`);
    return (res.rows as Array<{ tbl: string; col: string }>).map((r) => ({
      table: r.tbl,
      column: r.col,
    }));
  }

  /** Copies the platform's own paid sales records out of `orders`, without the buyer's identity, before the cascade removes them. */
  async archiveFinancialRecords(
    tx: Tx,
    id: number,
    uuid: string,
    retainYears: number,
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO financial_records_archive
        (org_uuid, order_uuid, order_number, kind, status, currency, amount, discount_amount, tax_rate, tax_amount, total_amount,
         billing_country, billing_tax_id, gateway_slug, gateway_order_id, gateway_payment_id, paid_at, order_created_at, retain_until)
      SELECT ${uuid}::uuid, o.uuid, o.order_number, o.kind, o.status, o.currency, o.amount, o.discount_amount, o.tax_rate, o.tax_amount,
             o.total_amount, o.billing_country, o.billing_tax_id, o.gateway_slug, o.gateway_order_id, o.gateway_payment_id, o.paid_at,
             o.created_at, now() + make_interval(years => ${retainYears})
        FROM orders o WHERE o.org_id = ${id} AND o.paid_at IS NOT NULL
      ON CONFLICT (order_number) DO NOTHING
      RETURNING id`);
    return res.rows.length;
  }

  /** Removes archived sales records whose legal retention period has passed. */
  async purgeExpiredFinancialRecords(tx: Tx, limit = 1000): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM financial_records_archive WHERE id IN (
        SELECT id FROM financial_records_archive WHERE retain_until < now() ORDER BY retain_until LIMIT ${limit})
      RETURNING id`);
    return res.rows.length;
  }

  /**
   * Erasure. Order matters: keep the legal sales records, queue the file purges, remove the PII-bearing streams, then the workspace
   * (whose foreign keys remove everything else).
   */
  async erase(
    tx: Tx,
    id: number,
    uuid: string,
    retainYears: number,
  ): Promise<{ filesQueued: number; ordersKept: number }> {
    const ordersKept = await this.archiveFinancialRecords(tx, id, uuid, retainYears);
    let filesQueued = 0;
    for (const { table, column } of await this.fileKeyColumns(tx)) {
      const t = sql.identifier(table);
      const c = sql.identifier(column);
      const res = await tx.execute(sql`
        INSERT INTO storage_purge_queue (org_id, org_uuid, storage_key)
        SELECT DISTINCT ${id}::bigint, ${uuid}::uuid, ${c} FROM ${t}
         WHERE org_id = ${id} AND ${c} IS NOT NULL AND btrim(${c}) <> ''
        RETURNING id`);
      filesQueued += res.rows.length;
    }
    // audit_log / event_outbox / security_events carry field values, IPs and user agents and have no cascading FK.
    await tx.execute(sql`DELETE FROM audit_log WHERE org_id = ${id}`);
    await tx.execute(sql`DELETE FROM event_outbox WHERE org_id = ${id}`);
    await tx.execute(sql`DELETE FROM security_events WHERE subject_org_id = ${id}`);
    await tx.execute(sql`DELETE FROM organizations WHERE id = ${id}`);
    return { filesQueued, ordersKept };
  }
}
