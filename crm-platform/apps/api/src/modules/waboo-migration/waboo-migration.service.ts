import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  deriveClientKey,
  type CreateWabooMigrationBatchInput,
  type CreateWabooMigrationRunInput,
  type WabooMigrationBatch,
  type WabooMigrationBatchDetail,
  type WabooMigrationReadiness,
  type WabooMigrationReport,
  type WabooMigrationRun,
  type WabooMigrationStep,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService, PlatformStore } from '../auth';
import { WabooMigrationJobs } from './waboo-migration.jobs';
import { latestDryOf } from './waboo-migration.stores';
import {
  canMove,
  delayFor,
  dryReadiness,
  loadGate,
  planBatch,
  runVerdict,
  validateRunAt,
  type BatchStatus,
  type RunMode,
  type RunStatus,
} from './waboo-migration.rules';

interface RunRow {
  id: number | string;
  uuid: string;
  source_client: string;
  source_db: string;
  mode: RunMode;
  status: RunStatus;
  steps: WabooMigrationStep[];
  report: WabooMigrationReport | null;
  error: string | null;
  position: number | null;
  run_at: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
  batch_uuid: string | null;
}
interface BatchRow {
  id: number | string;
  uuid: string;
  status: BatchStatus;
  mode: RunMode;
  run_at: Date | string | null;
  stop_on_failure: boolean;
  total_count: number;
  live_counts: Record<string, number>;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
}

const RUN_SELECT = sql.raw(`
  SELECT r.id, r.uuid, r.source_client, r.source_db, r.mode, r.status, r.steps, r.report, r.error, r.position, r.run_at,
         r.started_at, r.finished_at, r.created_at, b.uuid AS batch_uuid
  FROM waboo_migration_runs r LEFT JOIN waboo_migration_batches b ON b.id = r.batch_id`);
const BATCH_SELECT = sql.raw(`
  SELECT b.id, b.uuid, b.status, b.mode, b.run_at, b.stop_on_failure, b.total_count, b.started_at, b.finished_at, b.created_at,
    (SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
       FROM (SELECT status, count(*)::int AS n FROM waboo_migration_runs WHERE batch_id = b.id GROUP BY status) s) AS live_counts
  FROM waboo_migration_batches b`);

const iso = (v: Date | string | null): string | null =>
  v === null ? null : new Date(v).toISOString();
const pgCode = (err: unknown): string | undefined => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
};

/**
 * Operator panel for the Waboo -> WaDesk migration: create / list / read / cancel runs and bulk batches, and the readiness check
 * (HTTP side). The worker side lives in waboo-migration.stores.ts + waboo-migration.engine.ts. Super admin only; every change
 * records a security event in the same transaction.
 * Safety: this module never connects WhatsApp and never touches Waboo; the pipeline is a separate process that is only ever
 * given validated arguments. No credential is stored in a row.
 */
@Injectable()
export class WabooMigrationService {
  private readonly logger = new Logger(WabooMigrationService.name);

  constructor(
    private readonly store: PlatformStore,
    private readonly audit: AuthAuditService,
    private readonly jobs: WabooMigrationJobs,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  private scheduleOrThrow(runAt: string | undefined, now: Date): void {
    const bad = validateRunAt(runAt, now);
    if (bad)
      throw new AppError(
        ERROR_CODES.WMIG_SCHEDULE_INVALID,
        bad === 'past'
          ? 'Run at must be a time in the future.'
          : 'Run at can be at most 90 days ahead.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [
          {
            path: 'runAt',
            message: bad === 'past' ? 'Must be in the future' : 'At most 90 days ahead',
          },
        ],
      );
  }

  /** The derived client key may already belong to a different Waboo organization: refuse instead of mixing two clients. */
  private async assertNoCollision(tx: Tx, client: string, organizationId: string): Promise<void> {
    const res = await tx.execute(sql`
      SELECT 1 FROM waboo_migration_runs WHERE source_client = ${client} AND source_db <> ${organizationId} LIMIT 1
    `);
    if (res.rows.length > 0)
      throw new AppError(
        ERROR_CODES.WMIG_CLIENT_COLLISION,
        `The client key "${client}" is already used by a different Waboo organization.`,
        HttpStatus.CONFLICT,
      );
  }

  async create(input: CreateWabooMigrationRunInput): Promise<WabooMigrationRun> {
    const operatorId = this.operatorId();
    const now = new Date();
    this.scheduleOrThrow(input.runAt, now);
    const client = input.sourceClient ?? deriveClientKey(input.organizationId);
    const run = await this.store.tx(async (tx) => {
      await this.assertNoCollision(tx, client, input.organizationId);
      const blocked = loadGate({
        mode: input.mode,
        sourceClient: client,
        organizationId: input.organizationId,
        confirmClient: input.confirm,
        latestDry: await latestDryOf(tx, client),
        now,
      });
      if (blocked === 'confirm')
        throw new AppError(
          ERROR_CODES.WMIG_CONFIRM_MISMATCH,
          'Type the organization id to confirm a load.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'confirm', message: 'Must equal the organization id' }],
        );
      if (blocked === 'dry')
        throw new AppError(
          ERROR_CODES.WMIG_DRY_RUN_REQUIRED,
          'A load needs a green dry run for this organization from the last 24 hours.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );

      let row: RunRow | undefined;
      try {
        const res = await tx.execute(sql`
          INSERT INTO waboo_migration_runs (source_client, source_db, mode, status, run_at, created_by)
          VALUES (${client}, ${input.organizationId}, ${input.mode}, 'queued', ${input.runAt ?? null}::timestamptz, ${operatorId})
          RETURNING uuid
        `);
        const uuid = (res.rows[0] as { uuid: string }).uuid;
        row = await this.runByUuid(tx, uuid);
      } catch (err) {
        if (pgCode(err) === '23505')
          throw new AppError(
            ERROR_CODES.WMIG_RUN_ACTIVE,
            'A run for this organization is already queued or running.',
            HttpStatus.CONFLICT,
          );
        throw err;
      }
      await this.audit.record(tx, {
        event: 'platform.waboo_migration.created',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          runId: row.uuid,
          sourceClient: client,
          mode: input.mode,
          scheduled: input.runAt ?? null,
        },
      });
      return row;
    });

    try {
      await this.jobs.ensure(
        'migrate',
        run.uuid,
        delayFor(input.runAt ? new Date(input.runAt) : null, now),
      );
    } catch (err) {
      this.logger.error({ err, runId: run.uuid }, 'could not queue the migration run');
      await this.store.tx((tx) =>
        tx.execute(sql`
          UPDATE waboo_migration_runs SET status = 'failed', finished_at = now(), error = 'The run could not be queued.'
          WHERE id = ${Number(run.id)} AND status = 'queued'
        `),
      );
      throw err;
    }
    return this.toItem(run);
  }

  /** Per organization: is its latest dry run good enough to load (green, from the last 24 hours)? */
  async readiness(organizationIds: string[]): Promise<WabooMigrationReadiness> {
    const now = new Date();
    return this.store.tx(async (tx) => {
      const data: WabooMigrationReadiness['data'] = [];
      for (const organizationId of organizationIds) {
        const client = deriveClientKey(organizationId);
        const d = await latestDryOf(tx, client);
        const reason = dryReadiness(d, now);
        const rep = d
          ? ((
              (
                await tx.execute(
                  sql`SELECT report FROM waboo_migration_runs WHERE uuid = ${d.uuid}::uuid`,
                )
              ).rows[0] as { report: WabooMigrationReport | null } | undefined
            )?.report ?? null)
          : null;
        data.push({
          organizationId,
          sourceClient: client,
          canLoad: reason === 'ok',
          reason,
          verdict: d ? runVerdict(d.status, rep) : null,
          dryRunId: d?.uuid ?? null,
          dryRunAt: iso(d?.finishedAt ?? null),
        });
      }
      return { data };
    });
  }

  async createBatch(input: CreateWabooMigrationBatchInput): Promise<WabooMigrationBatchDetail> {
    const operatorId = this.operatorId();
    const now = new Date();
    this.scheduleOrThrow(input.runAt, now);
    const plan = planBatch(input.organizationIds);
    if (!plan.ok)
      throw new AppError(
        ERROR_CODES.WMIG_CLIENT_COLLISION,
        plan.reason === 'duplicate'
          ? `The organization id ${plan.organizationId} is listed twice.`
          : `The organization id ${plan.organizationId} gives the same client key as another one in the list.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'organizationIds', message: plan.organizationId }],
      );
    if (input.mode === 'load' && input.confirmCount !== plan.items.length)
      throw new AppError(
        ERROR_CODES.WMIG_CONFIRM_MISMATCH,
        'Type the number of organizations to confirm a load.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'confirmCount', message: 'Must equal the number of organizations' }],
      );

    const batchUuid = await this.store.tx(async (tx) => {
      const missing: string[] = [];
      for (const it of plan.items) {
        await this.assertNoCollision(tx, it.sourceClient, it.organizationId);
        // Enqueue-time gate: every organization needs a green dry run from the last 24 hours. The worker checks again at start.
        if (
          input.mode === 'load' &&
          dryReadiness(await latestDryOf(tx, it.sourceClient), now) !== 'ok'
        )
          missing.push(it.organizationId);
      }
      if (missing.length > 0)
        throw new AppError(
          ERROR_CODES.WMIG_DRY_RUN_REQUIRED,
          'A load needs a green dry run from the last 24 hours for every organization.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          missing.map((m) => ({ path: 'organizationIds', message: m })),
        );
      const b = await tx.execute(sql`
        INSERT INTO waboo_migration_batches (mode, run_at, stop_on_failure, total_count, created_by)
        VALUES (${input.mode}, ${input.runAt ?? null}::timestamptz, ${input.stopOnFailure}, ${plan.items.length}, ${operatorId})
        RETURNING id, uuid
      `);
      const batch = b.rows[0] as { id: number | string; uuid: string };
      try {
        for (const [i, it] of plan.items.entries())
          await tx.execute(sql`
            INSERT INTO waboo_migration_runs (source_client, source_db, mode, status, run_at, batch_id, position, created_by)
            VALUES (${it.sourceClient}, ${it.organizationId}, ${input.mode}, 'queued', ${input.runAt ?? null}::timestamptz,
                    ${Number(batch.id)}, ${i + 1}, ${operatorId})
          `);
      } catch (err) {
        if (pgCode(err) === '23505')
          throw new AppError(
            ERROR_CODES.WMIG_RUN_ACTIVE,
            'One of these organizations already has a run queued or running.',
            HttpStatus.CONFLICT,
          );
        throw err;
      }
      await this.audit.record(tx, {
        event: 'platform.waboo_migration.batch_created',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          batchId: batch.uuid,
          mode: input.mode,
          organizations: plan.items.length,
          stopOnFailure: input.stopOnFailure,
          scheduled: input.runAt ?? null,
        },
      });
      return batch.uuid;
    });

    try {
      await this.jobs.ensure(
        'batch',
        batchUuid,
        delayFor(input.runAt ? new Date(input.runAt) : null, now),
      );
    } catch (err) {
      this.logger.error({ err, batchId: batchUuid }, 'could not queue the migration batch');
      await this.store.tx(async (tx) => {
        await tx.execute(sql`
          UPDATE waboo_migration_runs SET status = 'failed', finished_at = now(), error = 'The batch could not be queued.'
          WHERE status = 'queued' AND batch_id = (SELECT id FROM waboo_migration_batches WHERE uuid = ${batchUuid}::uuid)
        `);
        await tx.execute(sql`
          UPDATE waboo_migration_batches SET status = 'failed', finished_at = now() WHERE uuid = ${batchUuid}::uuid
        `);
      });
      throw err;
    }
    return this.getBatch(batchUuid);
  }

  async listBatches(limit: number): Promise<WabooMigrationBatch[]> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`${BATCH_SELECT} ORDER BY b.id DESC LIMIT ${limit}`);
      return (res.rows as unknown as BatchRow[]).map((b) => this.toBatch(b));
    });
  }

  async getBatch(uuid: string): Promise<WabooMigrationBatchDetail> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`${BATCH_SELECT} WHERE b.uuid = ${uuid}::uuid`);
      const b = res.rows[0] as unknown as BatchRow | undefined;
      if (!b) throw AppError.notFound('Migration batch', uuid);
      const items = await tx.execute(
        sql`${RUN_SELECT} WHERE r.batch_id = ${Number(b.id)} ORDER BY r.position`,
      );
      return {
        ...this.toBatch(b),
        items: (items.rows as unknown as RunRow[]).map((r) => this.toItem(r)),
      };
    });
  }

  /** A queued batch is cancelled whole; a running one stops after the organization in progress (which cannot be stopped). */
  async cancelBatch(uuid: string): Promise<WabooMigrationBatchDetail> {
    const operatorId = this.operatorId();
    await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, status FROM waboo_migration_batches WHERE uuid = ${uuid}::uuid FOR UPDATE`,
      );
      const b = res.rows[0] as unknown as { id: number | string; status: BatchStatus } | undefined;
      if (!b) throw AppError.notFound('Migration batch', uuid);
      if (b.status !== 'queued' && b.status !== 'running')
        throw new AppError(
          ERROR_CODES.WMIG_NOT_CANCELLABLE,
          'This batch has already finished.',
          HttpStatus.CONFLICT,
        );
      await tx.execute(sql`
        UPDATE waboo_migration_runs SET status = 'cancelled', finished_at = now(), error = 'Cancelled with the batch.'
        WHERE batch_id = ${Number(b.id)} AND status = 'queued'
      `);
      await tx.execute(sql`
        UPDATE waboo_migration_batches SET status = 'cancelled', finished_at = now() WHERE id = ${Number(b.id)}
      `);
      await this.audit.record(tx, {
        event: 'platform.waboo_migration.batch_cancelled',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { batchId: uuid },
      });
    });
    await this.jobs.remove('batch', uuid);
    return this.getBatch(uuid);
  }

  async list(limit: number): Promise<WabooMigrationRun[]> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`${RUN_SELECT} ORDER BY r.id DESC LIMIT ${limit}`);
      return (res.rows as unknown as RunRow[]).map((r) => this.toItem(r));
    });
  }

  async get(uuid: string): Promise<WabooMigrationRun> {
    return this.store.tx(async (tx) => this.toItem(await this.runByUuid(tx, uuid)));
  }

  async cancel(uuid: string): Promise<WabooMigrationRun> {
    const operatorId = this.operatorId();
    await this.store.tx(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id, status, source_client, mode FROM waboo_migration_runs WHERE uuid = ${uuid}::uuid FOR UPDATE`,
      );
      const row = locked.rows[0] as unknown as
        | { id: number | string; status: RunStatus; source_client: string; mode: RunMode }
        | undefined;
      if (!row) throw AppError.notFound('Migration run', uuid);
      if (!canMove(row.status, 'cancelled'))
        throw new AppError(
          ERROR_CODES.WMIG_NOT_CANCELLABLE,
          row.status === 'running'
            ? 'A running migration cannot be cancelled.'
            : 'This run has already finished.',
          HttpStatus.CONFLICT,
        );
      const res = await tx.execute(sql`
        UPDATE waboo_migration_runs SET status = 'cancelled', finished_at = now()
        WHERE id = ${Number(row.id)} AND status = 'queued' RETURNING id
      `);
      if (res.rows.length === 0)
        throw new AppError(
          ERROR_CODES.WMIG_NOT_CANCELLABLE,
          'The run started before it could be cancelled.',
          HttpStatus.CONFLICT,
        );
      await this.audit.record(tx, {
        event: 'platform.waboo_migration.cancelled',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { runId: uuid, sourceClient: row.source_client, mode: row.mode },
      });
    });
    await this.jobs.remove('migrate', uuid);
    return this.get(uuid);
  }

  private async runByUuid(tx: Tx, uuid: string): Promise<RunRow> {
    const res = await tx.execute(sql`${RUN_SELECT} WHERE r.uuid = ${uuid}::uuid`);
    const row = res.rows[0] as unknown as RunRow | undefined;
    if (!row) throw AppError.notFound('Migration run', uuid);
    return row;
  }

  private toBatch(b: BatchRow): WabooMigrationBatch {
    return {
      id: b.uuid,
      status: b.status,
      mode: b.mode,
      runAt: iso(b.run_at),
      concurrency: 1,
      stopOnFailure: b.stop_on_failure,
      total: b.total_count,
      counts: b.live_counts,
      startedAt: iso(b.started_at),
      finishedAt: iso(b.finished_at),
      createdAt: iso(b.created_at)!,
    };
  }

  /** Mapper: the only place that shapes a row for the API. No internal id, creator or credential leaves here. */
  private toItem(r: RunRow): WabooMigrationRun {
    const verdict = runVerdict(r.status, r.report);
    return {
      id: r.uuid,
      organizationId: r.source_db,
      sourceClient: r.source_client,
      sourceDb: r.source_db,
      mode: r.mode,
      status: r.status,
      verdict,
      steps: r.steps,
      report: r.report
        ? { ...r.report, verdict: verdict ?? runVerdict('completed', r.report)! }
        : null,
      error: r.error,
      batchId: r.batch_uuid,
      position: r.position,
      runAt: iso(r.run_at),
      startedAt: iso(r.started_at),
      finishedAt: iso(r.finished_at),
      createdAt: iso(r.created_at)!,
    };
  }
}
