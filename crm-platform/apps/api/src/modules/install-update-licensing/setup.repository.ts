import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { LedgerEntry } from './migration-report';

/** A raw `execute` hands timestamptz back as the driver's text, not a Date. */
const toDate = (v: string | Date | null): Date | null => (v === null ? null : new Date(v));

export interface SetupState {
  completedAt: Date | null;
  completedVersion: string | null;
  operatorCount: number;
}

/**
 * Every statement the setup flow runs. Each takes the transaction its caller already holds (obtained through
 * PlatformStore or TenantDirectory), so none of them can open a privileged connection of its own.
 */
@Injectable()
export class SetupRepository {
  async state(tx: Tx): Promise<SetupState> {
    const res = await tx.execute(sql`
      SELECT
        (SELECT completed_at FROM platform_setup WHERE id = 1)      AS completed_at,
        (SELECT completed_version FROM platform_setup WHERE id = 1) AS completed_version,
        (SELECT count(*)::int FROM platform_operators)              AS operator_count
    `);
    const row = res.rows[0] as unknown as {
      completed_at: string | Date | null;
      completed_version: string | null;
      operator_count: number;
    };
    return {
      completedAt: toDate(row.completed_at),
      completedVersion: row.completed_version,
      operatorCount: row.operator_count,
    };
  }

  /**
   * The lock. An upsert whose UPDATE branch only fires while the row is still open, so exactly one transaction can
   * ever get a row back: a concurrent second claim waits on the first's row lock and, once that commits, finds
   * `completed_at` set and returns nothing. The row need not exist beforehand.
   */
  async claim(
    tx: Tx,
    input: { version: string; orgId: number; appUrl: string | null },
  ): Promise<Date | null> {
    const res = await tx.execute(sql`
      INSERT INTO platform_setup (id, completed_at, completed_version, first_org_id, app_url)
      VALUES (1, now(), ${input.version}, ${input.orgId}, ${input.appUrl})
      ON CONFLICT (id) DO UPDATE
        SET completed_at = EXCLUDED.completed_at,
            completed_version = EXCLUDED.completed_version,
            first_org_id = EXCLUDED.first_org_id,
            app_url = EXCLUDED.app_url
        WHERE platform_setup.completed_at IS NULL
      RETURNING completed_at
    `);
    const row = res.rows[0] as unknown as { completed_at: string | Date } | undefined;
    return toDate(row?.completed_at ?? null);
  }

  async insertOperator(
    tx: Tx,
    input: { email: string; fullName: string; passwordHash: string },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO platform_operators (email, full_name, password_hash, role, password_changed_at)
      VALUES (${input.email}, ${input.fullName}, ${input.passwordHash}, 'super_admin', now())
      RETURNING id, uuid
    `);
    return res.rows[0] as unknown as { id: number; uuid: string };
  }

  async linkOperator(tx: Tx, operatorId: number): Promise<void> {
    await tx.execute(sql`UPDATE platform_setup SET first_operator_id = ${operatorId} WHERE id = 1`);
  }

  async permissionDefCount(tx: Tx): Promise<number> {
    const res = await tx.execute(sql`SELECT count(*)::int AS n FROM permission_defs`);
    return (res.rows[0] as unknown as { n: number }).n;
  }

  async ledger(tx: Tx): Promise<LedgerEntry[]> {
    const res = await tx.execute(
      sql`SELECT id, checksum, applied_at FROM platform_migration_ledger()`,
    );
    return (res.rows as unknown as Array<{ id: string; checksum: string; applied_at: Date }>).map(
      (r) => ({ id: r.id, checksum: r.checksum, appliedAt: new Date(r.applied_at) }),
    );
  }
}
