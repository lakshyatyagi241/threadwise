import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { AuthAuditService, PlatformStore } from '../auth';
import {
  batchFinalStatus,
  scrub,
  type BatchStatus,
  type LatestDry,
  type RunMode,
  type RunStatus,
} from './waboo-migration.rules';
import type { BatchStore, ExecStore, Finish, RunHead, SweepStore } from './waboo-migration.engine';

type HeadRow = {
  id: number | string;
  uuid: string;
  source_client: string;
  source_db: string;
  mode: RunMode;
  status: string;
};
const head = (r: HeadRow): RunHead => ({
  id: Number(r.id),
  uuid: r.uuid,
  sourceClient: r.source_client,
  sourceDb: r.source_db,
  mode: r.mode,
  status: r.status,
});
const pgCode = (err: unknown): string | undefined => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
};

/** The latest dry run of a client, as the load gate reads it. */
export async function latestDryOf(
  tx: Tx,
  sourceClient: string,
): Promise<(LatestDry & { uuid: string }) | null> {
  const res = await tx.execute(sql`
    SELECT uuid, status, (report->>'green')::boolean AS green, finished_at
    FROM waboo_migration_runs
    WHERE source_client = ${sourceClient} AND mode = 'dry'
    ORDER BY id DESC LIMIT 1
  `);
  const d = res.rows[0] as
    | { uuid: string; status: RunStatus; green: boolean | null; finished_at: Date | string | null }
    | undefined;
  return d
    ? {
        uuid: d.uuid,
        status: d.status,
        green: d.green,
        finishedAt: d.finished_at ? new Date(d.finished_at) : null,
      }
    : null;
}

/**
 * Everything the worker reads and writes while it executes runs and batches (SQL behind the engine's store interfaces).
 * Platform tables, operator door (PlatformStore); every state change records a security event in the same transaction.
 */
@Injectable()
export class WabooMigrationStores {
  constructor(
    private readonly store: PlatformStore,
    private readonly audit: AuthAuditService,
  ) {}

  readonly exec: ExecStore = {
    peek: async (uuid) => {
      const res = await this.store.tx((tx) =>
        tx.execute(sql`
          SELECT id, uuid, source_client, source_db, mode, status FROM waboo_migration_runs WHERE uuid = ${uuid}::uuid
        `),
      );
      const r = res.rows[0] as unknown as HeadRow | undefined;
      return r ? head(r) : null;
    },

    latestDry: (client) => this.store.tx((tx) => latestDryOf(tx, client)),

    block: async (uuid, reason) => {
      await this.store.tx(async (tx) => {
        const res = await tx.execute(sql`
          UPDATE waboo_migration_runs SET status = 'blocked', finished_at = now(), error = ${reason}
          WHERE uuid = ${uuid}::uuid AND status = 'queued'
          RETURNING source_client, mode
        `);
        const r = res.rows[0] as unknown as { source_client: string; mode: RunMode } | undefined;
        if (!r) return;
        await this.audit.record(tx, {
          event: 'platform.waboo_migration.blocked',
          status: 'failure',
          actorType: 'system',
          payload: { runId: uuid, sourceClient: r.source_client, mode: r.mode },
        });
      });
    },

    // At most one run executes at a time: the NOT EXISTS is the cheap check, uq_wmig_one_running (unique index) the guarantee.
    begin: async (uuid) => {
      try {
        const res = await this.store.tx((tx) =>
          tx.execute(sql`
            UPDATE waboo_migration_runs SET status = 'running', started_at = now()
            WHERE uuid = ${uuid}::uuid AND status = 'queued'
              AND NOT EXISTS (SELECT 1 FROM waboo_migration_runs WHERE status = 'running')
            RETURNING id, uuid, source_client, source_db, mode, status
          `),
        );
        const r = res.rows[0] as unknown as HeadRow | undefined;
        if (r) return head(r);
      } catch (err) {
        if (pgCode(err) === '23505') return 'busy';
        throw err;
      }
      const still = await this.store.tx((tx) =>
        tx.execute(sql`SELECT status FROM waboo_migration_runs WHERE uuid = ${uuid}::uuid`),
      );
      return (still.rows[0] as { status?: string } | undefined)?.status === 'queued'
        ? 'busy'
        : null;
    },

    saveSteps: async (id, steps) => {
      await this.store.tx((tx) =>
        tx.execute(sql`
          UPDATE waboo_migration_runs SET steps = ${JSON.stringify(steps)}::jsonb
          WHERE id = ${id} AND status = 'running'
        `),
      );
    },

    finish: (id, f) => this.finishRun(id, f),
  };

  private async finishRun(id: number, f: Finish): Promise<void> {
    await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE waboo_migration_runs SET
          status = ${f.status}, finished_at = now(),
          error = ${f.error === null ? null : scrub(f.error).slice(0, 4000)},
          report = ${f.report ? JSON.stringify(f.report) : null}::jsonb,
          org_id = (SELECT id FROM organizations WHERE id = ${f.orgId}::bigint)
        WHERE id = ${id} AND status = 'running'
        RETURNING uuid, source_client, mode
      `);
      const row = res.rows[0] as unknown as
        { uuid: string; source_client: string; mode: RunMode } | undefined;
      if (!row) return;
      await this.audit.record(tx, {
        event: 'platform.waboo_migration.finished',
        status: f.status === 'completed' && f.report?.verdict !== 'red' ? 'info' : 'failure',
        actorType: 'system',
        payload: {
          runId: row.uuid,
          sourceClient: row.source_client,
          mode: row.mode,
          outcome: f.status,
          green: f.report?.green ?? null,
          verdict: f.report?.verdict ?? null,
        },
      });
    });
  }

  readonly batch: BatchStore = {
    begin: async (uuid) => {
      return this.store.tx(async (tx) => {
        await tx.execute(sql`
          UPDATE waboo_migration_batches SET status = 'running', started_at = now()
          WHERE uuid = ${uuid}::uuid AND status = 'queued'
        `);
        const res = await tx.execute(sql`
          SELECT status, stop_on_failure FROM waboo_migration_batches WHERE uuid = ${uuid}::uuid
        `);
        const b = res.rows[0] as unknown as
          { status: BatchStatus; stop_on_failure: boolean } | undefined;
        return b ? { status: b.status, stopOnFailure: b.stop_on_failure } : null;
      });
    },

    status: async (uuid) => {
      const res = await this.store.tx((tx) =>
        tx.execute(sql`SELECT status FROM waboo_migration_batches WHERE uuid = ${uuid}::uuid`),
      );
      return (res.rows[0] as { status?: BatchStatus } | undefined)?.status ?? null;
    },

    nextQueued: async (uuid) => {
      const res = await this.store.tx((tx) =>
        tx.execute(sql`
          SELECT r.uuid FROM waboo_migration_runs r
          JOIN waboo_migration_batches b ON b.id = r.batch_id
          WHERE b.uuid = ${uuid}::uuid AND r.status = 'queued'
          ORDER BY r.position LIMIT 1
        `),
      );
      return (res.rows[0] as { uuid?: string } | undefined)?.uuid ?? null;
    },

    cancelQueued: async (uuid, reason) => {
      await this.store.tx((tx) =>
        tx.execute(sql`
          UPDATE waboo_migration_runs SET status = 'cancelled', finished_at = now(), error = ${reason}
          WHERE status = 'queued' AND batch_id = (SELECT id FROM waboo_migration_batches WHERE uuid = ${uuid}::uuid)
        `),
      );
    },

    finalize: async (uuid) => {
      await this.store.tx(async (tx) => {
        const b = (
          await tx.execute(sql`
            SELECT id, status FROM waboo_migration_batches WHERE uuid = ${uuid}::uuid FOR UPDATE
          `)
        ).rows[0] as unknown as { id: number | string; status: BatchStatus } | undefined;
        if (!b) return;
        const rows = (
          await tx.execute(sql`
            SELECT status, count(*)::int AS n FROM waboo_migration_runs WHERE batch_id = ${Number(b.id)} GROUP BY status
          `)
        ).rows as unknown as Array<{ status: RunStatus; n: number }>;
        const counts: Partial<Record<RunStatus, number>> = {};
        for (const r of rows) counts[r.status] = r.n;
        const final = batchFinalStatus(b.status, counts);
        await tx.execute(sql`
          UPDATE waboo_migration_batches
          SET status = ${final}, counts = ${JSON.stringify(counts)}::jsonb, finished_at = COALESCE(finished_at, now())
          WHERE id = ${Number(b.id)}
        `);
        await this.audit.record(tx, {
          event: 'platform.waboo_migration.batch_finished',
          status: final === 'failed' ? 'failure' : 'info',
          actorType: 'system',
          payload: { batchId: uuid, outcome: final, counts },
        });
      });
    },
  };

  readonly sweep: SweepStore = {
    failStale: (timeoutMs) =>
      this.store.tx(async (tx) => {
        const res = await tx.execute(sql`
          UPDATE waboo_migration_runs SET status = 'failed', finished_at = now(),
            error = 'The worker stopped before this run finished.'
          WHERE status = 'running' AND started_at < now() - (${Math.ceil(timeoutMs / 1000)} * interval '1 second')
          RETURNING uuid, source_client, mode
        `);
        for (const r of res.rows as unknown as Array<{
          uuid: string;
          source_client: string;
          mode: RunMode;
        }>)
          await this.audit.record(tx, {
            event: 'platform.waboo_migration.finished',
            status: 'failure',
            actorType: 'system',
            payload: {
              runId: r.uuid,
              sourceClient: r.source_client,
              mode: r.mode,
              outcome: 'failed',
              swept: true,
            },
          });
        return res.rows.length;
      }),

    pendingRuns: async () => {
      const res = await this.store.tx((tx) =>
        tx.execute(sql`
          SELECT uuid, run_at FROM waboo_migration_runs WHERE status = 'queued' AND batch_id IS NULL
        `),
      );
      return (res.rows as unknown as Array<{ uuid: string; run_at: Date | string | null }>).map(
        (r) => ({ uuid: r.uuid, runAt: r.run_at ? new Date(r.run_at) : null }),
      );
    },

    pendingBatches: async () => {
      const res = await this.store.tx((tx) =>
        tx.execute(sql`
          SELECT uuid, run_at FROM waboo_migration_batches WHERE status IN ('queued', 'running')
        `),
      );
      return (res.rows as unknown as Array<{ uuid: string; run_at: Date | string | null }>).map(
        (r) => ({ uuid: r.uuid, runAt: r.run_at ? new Date(r.run_at) : null }),
      );
    },
  };
}
