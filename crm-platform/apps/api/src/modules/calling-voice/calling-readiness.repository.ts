import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { CallingCheck, CallingCheckSource, CallingReadinessStatus } from '@crm/contracts';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;
const date = (v: unknown): Date | null => (v ? new Date(v as string) : null);

/** A number with its last readiness result (nothing but the number when it has never been checked). */
export interface ReadinessRow {
  numberId: number;
  numberUuid: string;
  phoneNumber: string | null;
  displayLabel: string | null;
  connectionStatus: string;
  callingEnabled: boolean;
  status: CallingReadinessStatus;
  checks: CallingCheck[];
  metaStatus: 'ENABLED' | 'DISABLED' | null;
  checkedAt: Date | null;
  source: CallingCheckSource | null;
  autoEnablePending: boolean;
  autoEnableAttempts: number;
}

const toReadiness = (r: Row): ReadinessRow => ({
  numberId: Number(r.id),
  numberUuid: String(r.uuid),
  phoneNumber: (r.phone_number as string | null) ?? null,
  displayLabel: (r.display_label as string | null) ?? null,
  connectionStatus: String(r.number_status),
  callingEnabled: r.calling_enabled === true,
  status: ((r.r_status as string | null) ?? 'never_checked') as CallingReadinessStatus,
  checks: ((r.checks as CallingCheck[] | null) ?? []) as CallingCheck[],
  metaStatus: (r.meta_status as 'ENABLED' | 'DISABLED' | null) ?? null,
  checkedAt: date(r.checked_at),
  source: (r.source as CallingCheckSource | null) ?? null,
  autoEnablePending: r.auto_enable_pending === true,
  autoEnableAttempts: Number(r.auto_enable_attempts ?? 0),
});

const SELECT = sql`
  SELECT c.id, c.uuid, c.status AS number_status, c.phone_number, c.display_label, c.calling_enabled,
         r.status AS r_status, r.checks, r.meta_status, r.checked_at, r.source,
         r.auto_enable_pending, r.auto_enable_attempts
  FROM wa_provider_configs c
  LEFT JOIN wa_calling_readiness r ON r.org_id = c.org_id AND r.config_id = c.id`;

export interface SettingsRow {
  autoEnableOnConnect: boolean;
  rowVersion: number;
  updatedAt: Date;
}

/** SQL for the readiness results, the workspace's auto-enable setting and the schedule. Every method runs in the caller's transaction. */
@Injectable()
export class CallingReadinessRepository {
  async list(tx: Tx, orgId: number): Promise<ReadinessRow[]> {
    const res = await tx.execute(sql`${SELECT}
      WHERE c.org_id = ${orgId} AND c.provider = 'waba'
      ORDER BY c.is_primary DESC, c.connected_at DESC NULLS LAST, c.id`);
    return rowsOf(res).map(toReadiness);
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<ReadinessRow | null> {
    const res = await tx.execute(sql`${SELECT}
      WHERE c.org_id = ${orgId} AND c.provider = 'waba' AND c.uuid = ${uuid}::uuid`);
    const r = rowsOf(res)[0];
    return r ? toReadiness(r) : null;
  }

  /** The stored status of a number's checklist, locked for the rest of the transaction (so two checks do not both log the same change). */
  async statusForUpdate(
    tx: Tx,
    orgId: number,
    configId: number,
  ): Promise<CallingReadinessStatus | null> {
    const res = await tx.execute(sql`
      SELECT status FROM wa_calling_readiness WHERE org_id = ${orgId} AND config_id = ${configId} FOR UPDATE`);
    const r = rowsOf(res)[0];
    return r ? (String(r.status) as CallingReadinessStatus) : null;
  }

  /** The database's own clock for this transaction: what "since the check began" is measured against (not the app's clock). */
  async dbNow(tx: Tx): Promise<Date> {
    const res = await tx.execute(sql`SELECT now() AS t`);
    return new Date(rowsOf(res)[0]!.t as string);
  }

  /**
   * Stores the result; one row per number, replaced by the next check. Ordered: a check that finished later than this one (they can
   * overlap) is not overwritten by it. Returns whether this result was the one kept.
   */
  async save(
    tx: Tx,
    orgId: number,
    configId: number,
    v: {
      status: CallingReadinessStatus;
      checks: CallingCheck[];
      metaStatus: 'ENABLED' | 'DISABLED' | null;
      source: CallingCheckSource;
      checkedAt: Date;
      nextCheckAt: Date;
      autoEnablePending: boolean;
      autoEnableAttempts: number;
    },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      INSERT INTO wa_calling_readiness (org_id, config_id, status, checks, meta_status, checked_at, source, next_check_at,
                                        auto_enable_pending, auto_enable_attempts)
      VALUES (${orgId}, ${configId}, ${v.status}, ${JSON.stringify(v.checks)}::jsonb, ${v.metaStatus},
              ${v.checkedAt.toISOString()}::timestamptz, ${v.source}, ${v.nextCheckAt.toISOString()}::timestamptz,
              ${v.autoEnablePending}, ${v.autoEnableAttempts})
      ON CONFLICT (org_id, config_id) DO UPDATE
        SET status = EXCLUDED.status, checks = EXCLUDED.checks, meta_status = EXCLUDED.meta_status,
            checked_at = EXCLUDED.checked_at, source = EXCLUDED.source, next_check_at = EXCLUDED.next_check_at,
            auto_enable_pending = EXCLUDED.auto_enable_pending, auto_enable_attempts = EXCLUDED.auto_enable_attempts
        WHERE wa_calling_readiness.checked_at IS NULL OR wa_calling_readiness.checked_at <= EXCLUDED.checked_at
      RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** A person turned calling off: a switch-on that was still waiting is withdrawn. */
  async clearPending(tx: Tx, orgId: number, configId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_calling_readiness SET auto_enable_pending = false, auto_enable_attempts = 0
      WHERE org_id = ${orgId} AND config_id = ${configId} AND auto_enable_pending`);
  }

  /**
   * People of the workspace who may place and answer calls: active, holding an allow of `call.calls.use` through some role and no
   * deny through any (deny beats allow, as the guard merges grants).
   */
  async diallers(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(DISTINCT u.id)::int AS n
      FROM users u
      JOIN user_roles ur ON ur.org_id = u.org_id AND ur.user_id = u.id
      JOIN role_grants rg ON rg.org_id = ur.org_id AND rg.role_id = ur.role_id
       AND rg.permission_key = 'call.calls.use' AND rg.effect::text = 'allow'
      WHERE u.org_id = ${orgId} AND u.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM user_roles ur2
          JOIN role_grants d ON d.org_id = ur2.org_id AND d.role_id = ur2.role_id
           AND d.permission_key = 'call.calls.use' AND d.effect::text = 'deny'
          WHERE ur2.org_id = u.org_id AND ur2.user_id = u.id)`);
    return Number(rowsOf(res)[0]?.n ?? 0);
  }

  // --- the workspace setting ------------------------------------------------------------------------------------------------

  async settings(tx: Tx, orgId: number): Promise<SettingsRow | null> {
    const res = await tx.execute(sql`
      SELECT auto_enable_on_connect, row_version, updated_at FROM wa_calling_settings WHERE org_id = ${orgId}`);
    const r = rowsOf(res)[0];
    return r
      ? {
          autoEnableOnConnect: r.auto_enable_on_connect === true,
          rowVersion: Number(r.row_version),
          updatedAt: new Date(r.updated_at as string),
        }
      : null;
  }

  async insertSettings(
    tx: Tx,
    orgId: number,
    autoEnableOnConnect: boolean,
    userId: number | null,
  ): Promise<SettingsRow | null> {
    // Two first saves at once: the second one finds the row there and is told the version moved, not a 500.
    const res = await tx.execute(sql`
      INSERT INTO wa_calling_settings (org_id, auto_enable_on_connect, updated_by)
      VALUES (${orgId}, ${autoEnableOnConnect}, ${userId})
      ON CONFLICT (org_id) DO NOTHING
      RETURNING auto_enable_on_connect, row_version, updated_at`);
    const r = rowsOf(res)[0];
    if (!r) return null;
    return {
      autoEnableOnConnect: r.auto_enable_on_connect === true,
      rowVersion: Number(r.row_version),
      updatedAt: new Date(r.updated_at as string),
    };
  }

  /** `null` when the version moved on (someone else saved first). */
  async updateSettings(
    tx: Tx,
    orgId: number,
    autoEnableOnConnect: boolean,
    userId: number | null,
    rowVersion: number,
  ): Promise<SettingsRow | null> {
    const res = await tx.execute(sql`
      UPDATE wa_calling_settings SET auto_enable_on_connect = ${autoEnableOnConnect}, updated_by = ${userId}
      WHERE org_id = ${orgId} AND row_version = ${rowVersion}
      RETURNING auto_enable_on_connect, row_version, updated_at`);
    const r = rowsOf(res)[0];
    return r
      ? {
          autoEnableOnConnect: r.auto_enable_on_connect === true,
          rowVersion: Number(r.row_version),
          updatedAt: new Date(r.updated_at as string),
        }
      : null;
  }

  // --- the schedule (privileged: spans workspaces; nothing here is reachable from a request) -------------------------------------

  /**
   * Takes the numbers the schedule should look at now, and moves their `next_check_at` half an hour on in the same statement, so a number
   * whose job fails or waits in a backlog is not taken again every window and cannot starve the others. Connected numbers with calling on,
   * or already checked once (a number nobody prepared is looked at when it is connected and then only if it was ever prepared). A number
   * with no row yet gets one (never_checked). Oldest due first. Several workers may call this at once: `SKIP LOCKED` gives each its own.
   */
  async due(tx: Tx, limit: number): Promise<Array<{ orgId: number; uuid: string }>> {
    const res = await tx.execute(sql`
      WITH due AS (
        SELECT c.org_id, c.id AS config_id, c.uuid
        FROM wa_provider_configs c
        LEFT JOIN wa_calling_readiness r ON r.org_id = c.org_id AND r.config_id = c.id
        WHERE c.provider = 'waba' AND c.status = 'connected'
          AND (c.calling_enabled OR r.id IS NOT NULL)
          AND (r.next_check_at IS NULL OR r.next_check_at <= now())
        ORDER BY r.next_check_at NULLS FIRST, c.id
        LIMIT ${limit}
        FOR UPDATE OF c SKIP LOCKED
      ), claimed AS (
        INSERT INTO wa_calling_readiness (org_id, config_id, next_check_at)
        SELECT org_id, config_id, now() + interval '30 minutes' FROM due
        ON CONFLICT (org_id, config_id) DO UPDATE SET next_check_at = EXCLUDED.next_check_at
          WHERE wa_calling_readiness.next_check_at IS NULL OR wa_calling_readiness.next_check_at <= now()
        RETURNING org_id, config_id
      )
      SELECT d.org_id, d.uuid FROM due d JOIN claimed k ON k.org_id = d.org_id AND k.config_id = d.config_id`);
    return rowsOf(res).map((r) => ({ orgId: Number(r.org_id), uuid: String(r.uuid) }));
  }

  /** Gives claimed numbers back to the schedule (their jobs could not be queued), so they are due again at once. */
  async release(tx: Tx, numbers: ReadonlyArray<{ orgId: number; uuid: string }>): Promise<void> {
    if (numbers.length === 0) return;
    for (const n of numbers) {
      await tx.execute(sql`
        UPDATE wa_calling_readiness r SET next_check_at = now()
        FROM wa_provider_configs c
        WHERE c.org_id = r.org_id AND c.id = r.config_id AND c.org_id = ${n.orgId} AND c.uuid = ${n.uuid}::uuid`);
    }
  }
}
