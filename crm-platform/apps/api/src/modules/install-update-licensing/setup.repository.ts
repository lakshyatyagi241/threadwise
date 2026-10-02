import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { LedgerEntry } from './migration-report';

/** A raw `execute` hands timestamptz back as the driver's text, not a Date. */
const toDate = (v: string | Date | null): Date | null => (v === null ? null : new Date(v));
const toNum = (v: string | number | null): number | null => (v === null ? null : Number(v));

export interface SetupState {
  completedAt: Date | null;
  completedVersion: string | null;
  /** Highest install-run step that succeeded (0 when nothing ran or the row does not exist yet). */
  runStep: number;
  firstOperatorId: number | null;
  firstOrgId: number | null;
  /** Operators other than the one this setup run created: someone (the CLI) already owns the platform. */
  foreignOperators: number;
}

export interface SetupSummary {
  completedAt: Date | null;
  org: { uuid: string; slug: string; name: string };
  operator: { uuid: string; email: string };
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
        s.completed_at, s.completed_version, s.run_step, s.first_operator_id, s.first_org_id,
        (SELECT count(*)::int FROM platform_operators o
          WHERE o.id IS DISTINCT FROM s.first_operator_id) AS foreign_operators
      FROM (SELECT 1) AS one
      LEFT JOIN platform_setup s ON s.id = 1
    `);
    const row = res.rows[0] as unknown as {
      completed_at: string | Date | null;
      completed_version: string | null;
      run_step: number | null;
      first_operator_id: string | number | null;
      first_org_id: string | number | null;
      foreign_operators: number;
    };
    return {
      completedAt: toDate(row.completed_at),
      completedVersion: row.completed_version,
      runStep: row.run_step ?? 0,
      firstOperatorId: toNum(row.first_operator_id),
      firstOrgId: toNum(row.first_org_id),
      foreignOperators: row.foreign_operators,
    };
  }

  /** The singleton row, created on first use. Locking it is what serialises two concurrent runs of step 4. */
  async lockRow(tx: Tx): Promise<{ completedAt: Date | null; firstOperatorId: number | null }> {
    await tx.execute(sql`INSERT INTO platform_setup (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    const res = await tx.execute(
      sql`SELECT completed_at, first_operator_id FROM platform_setup WHERE id = 1 FOR UPDATE`,
    );
    const row = res.rows[0] as unknown as {
      completed_at: string | Date | null;
      first_operator_id: string | number | null;
    };
    return { completedAt: toDate(row.completed_at), firstOperatorId: toNum(row.first_operator_id) };
  }

  /** Records that a step succeeded. Never moves backwards, and never touches a completed install. */
  async advance(tx: Tx, step: number): Promise<void> {
    await tx.execute(sql`
      INSERT INTO platform_setup (id, run_step) VALUES (1, ${step})
      ON CONFLICT (id) DO UPDATE SET run_step = GREATEST(platform_setup.run_step, EXCLUDED.run_step)
        WHERE platform_setup.completed_at IS NULL
    `);
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

  /** Step 4's record of what it created; the lock itself is only taken by `complete`. */
  async linkProvisioned(
    tx: Tx,
    input: { operatorId: number; orgId: number; appUrl: string | null },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE platform_setup
         SET first_operator_id = ${input.operatorId}, first_org_id = ${input.orgId},
             app_url = ${input.appUrl}, run_step = GREATEST(run_step, 4)
       WHERE id = 1 AND completed_at IS NULL
    `);
  }

  /**
   * The lock. The UPDATE only fires while the row is still open, so exactly one transaction can ever get a row back:
   * a concurrent second finalize waits on the first's row lock and, once that commits, matches nothing.
   */
  async complete(tx: Tx, version: string): Promise<Date | null> {
    const res = await tx.execute(sql`
      UPDATE platform_setup
         SET completed_at = now(), completed_version = ${version}, run_step = 6
       WHERE id = 1 AND completed_at IS NULL AND first_operator_id IS NOT NULL
      RETURNING completed_at
    `);
    const row = res.rows[0] as unknown as { completed_at: string | Date } | undefined;
    return toDate(row?.completed_at ?? null);
  }

  /** What the final response and the completion event report: the operator and workspace step 4 created. */
  async summary(tx: Tx): Promise<SetupSummary | null> {
    const res = await tx.execute(sql`
      SELECT s.completed_at, o.uuid AS org_uuid, o.slug AS org_slug, o.name AS org_name,
             p.uuid AS operator_uuid, p.email AS operator_email
        FROM platform_setup s
        JOIN organizations o ON o.id = s.first_org_id
        JOIN platform_operators p ON p.id = s.first_operator_id
       WHERE s.id = 1
    `);
    const r = res.rows[0] as unknown as
      | {
          completed_at: string | Date | null;
          org_uuid: string;
          org_slug: string;
          org_name: string;
          operator_uuid: string;
          operator_email: string;
        }
      | undefined;
    if (!r) return null;
    return {
      completedAt: toDate(r.completed_at),
      org: { uuid: r.org_uuid, slug: r.org_slug, name: r.org_name },
      operator: { uuid: r.operator_uuid, email: r.operator_email },
    };
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
