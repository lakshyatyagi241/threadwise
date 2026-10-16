import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ERROR_CODES,
  LEAD_BACKFILL_MAX_DAYS,
  type BackfillLeadsInput,
  type BackfillLeadsResponse,
  type LeadPullSource as PullSourceView,
  type LeadPullSourcesResponse,
  type LeadSyncKind,
  type LeadSyncRun,
  type LeadSyncRunsResponse,
  type ListLeadSyncRunsQuery,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { runInOrg } from './lead-context';
import type { LeadPullProgress, LeadPullResult, LeadPullSource } from './lead-pull.port';
import { LeadPullRegistry } from './lead-pull.registry';
import { LeadSyncRunsRepository, type SyncRunRow } from './lead-sync-runs.repository';
import { LeadSourcesRepository, type LeadSourceRow } from './lead-sources.repository';
import { isUniqueViolation } from './lead-sources.service';

const MODULE_KEY = 'lead_sync_runs';

/** No two manual pulls of a source closer than this, whatever the source itself would allow. */
export const MANUAL_MIN_INTERVAL_SECONDS = 60;
/** After a backfill, the next one waits this long: a backfill asks the source for a lot, and a mistyped range should not be repeated at once. */
export const BACKFILL_COOLDOWN_SECONDS = 600;
/** Progress is written at most this often. */
const PROGRESS_EVERY_MS = 1_000;

export interface SyncJob {
  orgId: number;
  runId: number;
}

const ZERO: LeadPullProgress = {
  fetched: 0,
  accepted: 0,
  duplicates: 0,
  failed: 0,
  windowsDone: 0,
  windowsTotal: 0,
};

const refOf = (s: LeadSourceRow): LeadPullSource => ({
  id: s.id,
  uuid: s.uuid,
  kind: s.kind,
  providerKey: s.providerKey,
  externalRef: s.externalRef,
});

export function toSyncRun(r: SyncRunRow): LeadSyncRun {
  return {
    id: r.uuid,
    sourceId: r.sourceUuid,
    sourceName: r.sourceName,
    kind: r.kind,
    status: r.status,
    rangeFrom: r.rangeFrom?.toISOString() ?? null,
    rangeTo: r.rangeTo?.toISOString() ?? null,
    fetched: r.fetched,
    accepted: r.accepted,
    duplicates: r.duplicates,
    failed: r.failed,
    windowsDone: r.windowsDone,
    windowsTotal: r.windowsTotal,
    error: r.error,
    requestedAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

type SkipReason = BackfillLeadsResponse['skipped'][number]['reason'];

const notFound = (uuid: string) => AppError.notFound('Lead source', uuid);

/**
 * "Sync now" and backfill for lead sources that can be pulled (BL-014, spec L-18). This service owns what is the same for every source:
 * who may ask (the controller), one run at a time per source (a partial unique index, not a check), the rate limit, the worker job, the
 * progress, the audit and the outbox. What is specific to a source (can it pull, how far back, how) is its provider's
 * (`lead-pull.port.ts`); the provider hands every lead to the pipeline, whose idempotency key makes a lead fetched twice a no-op.
 *
 * Rate limits, three of them: the source's own (a portal's minimum interval, kept by the provider as well), a minute between manual
 * pulls of one source, and ten minutes between backfills of it. A refusal is 429 `LEAD_SYNC_TOO_SOON` with the seconds to wait.
 */
@Injectable()
export class LeadSyncService {
  private readonly logger = new Logger(LeadSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly sources: LeadSourcesRepository,
    private readonly runs: LeadSyncRunsRepository,
    private readonly registry: LeadPullRegistry,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @InjectQueue(QUEUES.LEAD_SYNC) private readonly queue: Queue<SyncJob>,
  ) {}

  // --- reads ---------------------------------------------------------------------------------------------------------------------

  /** Every source that can be pulled, what it can do, when "Sync now" is accepted again, and its open and latest run. */
  async pullSources(): Promise<LeadPullSourcesResponse> {
    const ctx = RequestContextStore.require();
    const all = await this.db.tx((tx) => this.sources.list(tx, ctx.orgId));
    const resolved: Array<{
      source: LeadSourceRow;
      caps: NonNullable<Awaited<ReturnType<LeadPullRegistry['resolve']>>>;
    }> = [];
    for (const source of all) {
      const caps = await this.registry.resolve(ctx.orgId, refOf(source));
      if (caps) resolved.push({ source, caps });
    }
    const { last, open } = await this.db.tx((tx) =>
      this.runs.latestOf(
        tx,
        ctx.orgId,
        resolved.map((x) => x.source.id),
      ),
    );
    const now = Date.now();
    const data: PullSourceView[] = resolved.map(({ source, caps }) => {
      const c = caps.capabilities;
      const lastRun = last.get(source.id) ?? null;
      const min = Math.max(c.minIntervalSeconds, MANUAL_MIN_INTERVAL_SECONDS);
      const next = lastRun ? new Date(lastRun.createdAt.getTime() + min * 1000) : null;
      return {
        sourceId: source.uuid,
        sourceName: source.name,
        sourceKind: source.kind,
        sourceStatus: source.status,
        canSync: c.sync,
        canBackfill: c.backfill,
        minIntervalSeconds: min,
        maxBackfillDays: c.backfill ? Math.max(1, Math.floor(c.maxBackfillSeconds / 86_400)) : null,
        nextSyncAt: next && next.getTime() > now ? next.toISOString() : null,
        activeRun: open.has(source.id) ? toSyncRun(open.get(source.id)!) : null,
        lastRun: lastRun ? toSyncRun(lastRun) : null,
      };
    });
    return { data };
  }

  async recent(query: ListLeadSyncRunsQuery): Promise<LeadSyncRunsResponse> {
    const ctx = RequestContextStore.require();
    const rows = await this.db.tx((tx) =>
      this.runs.recent(tx, ctx.orgId, { sourceUuid: query.sourceId, limit: query.limit }),
    );
    return { data: rows.map(toSyncRun) };
  }

  // --- asking ----------------------------------------------------------------------------------------------------------------------

  /** "Sync now": fetch what is new at this source. */
  async syncNow(sourceUuid: string): Promise<LeadSyncRun> {
    const ctx = RequestContextStore.require();
    const source = await this.mustFind(ctx.orgId, sourceUuid);
    const run = await this.open(ctx.orgId, ctx.userId, source, 'sync', null, null);
    if (run.kind === 'refused') throw run.error;
    return run.run;
  }

  /** A backfill of a range at the sources named (or at every source that can backfill). A source that cannot, is paused, is being pulled or was asked too recently is reported in `skipped`, not an error. */
  async backfill(input: BackfillLeadsInput): Promise<BackfillLeadsResponse> {
    const ctx = RequestContextStore.require();
    const from = new Date(input.from);
    const to = new Date(input.to);
    if (to.getTime() > Date.now() + 60_000) {
      throw this.rangeInvalid('the end is in the future', 'to');
    }
    const all = await this.db.tx((tx) => this.sources.list(tx, ctx.orgId));
    const wanted = input.sourceIds
      ? input.sourceIds.map((id) => ({ id, row: all.find((s) => s.uuid === id) }))
      : all.map((row) => ({ id: row.uuid, row }));
    const out: BackfillLeadsResponse = { runs: [], skipped: [] };
    for (const w of wanted) {
      if (!w.row) {
        out.skipped.push({ sourceId: w.id, reason: 'not_found' });
        continue;
      }
      const res = await this.open(ctx.orgId, ctx.userId, w.row, 'backfill', from, to, true);
      if (res.kind === 'opened') out.runs.push(res.run);
      else if (res.skip) out.skipped.push({ sourceId: w.id, reason: res.skip });
      else throw res.error;
    }
    return out;
  }

  private async mustFind(orgId: number, uuid: string): Promise<LeadSourceRow> {
    const row = await this.db.tx((tx) => this.sources.findByUuid(tx, orgId, uuid));
    if (!row) throw notFound(uuid);
    return row;
  }

  private rangeInvalid(message: string, path: string): AppError {
    return new AppError(
      ERROR_CODES.LEAD_BACKFILL_RANGE_INVALID,
      `This range cannot be pulled: ${message}.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path, message }],
    );
  }

  /**
   * Queues one run, or says why not. `quiet` is a bulk backfill over every source: a source that cannot take it is skipped with a reason
   * instead of failing the whole request; asked for one by name, the same condition is an error with its own code.
   */
  private async open(
    orgId: number,
    userId: number | null,
    source: LeadSourceRow,
    kind: LeadSyncKind,
    from: Date | null,
    to: Date | null,
    quiet = false,
  ): Promise<
    { kind: 'opened'; run: LeadSyncRun } | { kind: 'refused'; error: AppError; skip?: SkipReason }
  > {
    const resolved = await this.registry.resolve(orgId, refOf(source));
    const refuse = (error: AppError, skip: SkipReason) => ({
      kind: 'refused' as const,
      error,
      skip: quiet ? skip : undefined,
    });

    const supported = resolved?.capabilities[kind === 'sync' ? 'sync' : 'backfill'] === true;
    if (!resolved || !supported) {
      return refuse(
        new AppError(
          ERROR_CODES.LEAD_SYNC_NOT_SUPPORTED,
          kind === 'sync'
            ? 'This source sends its leads by itself: there is nothing to pull.'
            : 'This source cannot be backfilled for a date range.',
          HttpStatus.CONFLICT,
        ),
        'not_supported',
      );
    }
    if (source.status !== 'active') {
      return refuse(
        new AppError(
          ERROR_CODES.LEAD_SOURCE_PAUSED,
          'This source is paused. Resume it to pull its leads.',
          HttpStatus.CONFLICT,
        ),
        'paused',
      );
    }
    const caps = resolved.capabilities;
    if (kind === 'backfill' && from && to) {
      const reach = Math.min(caps.maxBackfillSeconds, LEAD_BACKFILL_MAX_DAYS * 86_400) * 1000;
      if (from.getTime() < Date.now() - reach) {
        return refuse(
          this.rangeInvalid(
            `this source keeps leads for about ${Math.floor(reach / 86_400_000)} days`,
            'from',
          ),
          'range_too_old',
        );
      }
    }

    const opened = await this.db.tx(async (tx) => {
      // "Already being pulled" is the truer answer than "too soon" while a run is open; the unique index still decides a race.
      if (await this.runs.hasOpen(tx, orgId, source.id)) {
        return {
          ok: false as const,
          inProgress: true,
          error: new AppError(
            ERROR_CODES.LEAD_SYNC_IN_PROGRESS,
            'This source is already being pulled. Wait for it to finish.',
            HttpStatus.CONFLICT,
          ),
        };
      }
      const wait = await this.waitSeconds(tx, orgId, source.id, kind, caps.minIntervalSeconds);
      if (wait > 0) {
        return {
          ok: false as const,
          inProgress: false,
          error: new AppError(
            ERROR_CODES.LEAD_SYNC_TOO_SOON,
            `This source was asked a moment ago. Try again in ${wait} seconds.`,
            HttpStatus.TOO_MANY_REQUESTS,
            [{ path: 'retryAfterSeconds', message: String(wait) }],
          ),
        };
      }
      let id: number;
      try {
        id = await this.runs.insert(tx, orgId, {
          sourceId: source.id,
          kind,
          from,
          to,
          requestedBy: userId,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          return {
            ok: false as const,
            inProgress: true,
            error: new AppError(
              ERROR_CODES.LEAD_SYNC_IN_PROGRESS,
              'This source is already being pulled. Wait for it to finish.',
              HttpStatus.CONFLICT,
            ),
          };
        }
        throw err;
      }
      const row = (await this.runs.byId(tx, orgId, id))!;
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: id,
        action: 'insert',
        delta: {
          kind: { old: null, new: kind },
          ...(from && to
            ? { range: { old: null, new: `${from.toISOString()}/${to.toISOString()}` } }
            : {}),
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'leads',
        aggregateId: id,
        eventType: 'lead.sync.requested',
        orgId,
        payload: { runId: row.uuid, leadSourceId: source.uuid, kind },
      });
      return { ok: true as const, row };
    });
    if (!opened.ok) return refuse(opened.error, opened.inProgress ? 'in_progress' : 'too_soon');
    await this.enqueue({ orgId, runId: opened.row.id });
    return { kind: 'opened', run: toSyncRun(opened.row) };
  }

  /** Seconds until this source may be asked again, 0 when it may be asked now. */
  private async waitSeconds(
    tx: Tx,
    orgId: number,
    sourceId: number,
    kind: LeadSyncKind,
    sourceMinInterval: number,
  ): Promise<number> {
    const now = Date.now();
    const gaps: Array<[Date | null, number]> = [
      [
        await this.runs.lastAskedAt(tx, orgId, sourceId),
        Math.max(sourceMinInterval, MANUAL_MIN_INTERVAL_SECONDS),
      ],
    ];
    if (kind === 'backfill') {
      gaps.push([
        await this.runs.lastAskedAt(tx, orgId, sourceId, 'backfill'),
        BACKFILL_COOLDOWN_SECONDS,
      ]);
    }
    let wait = 0;
    for (const [at, seconds] of gaps) {
      if (at) wait = Math.max(wait, Math.ceil((at.getTime() + seconds * 1000 - now) / 1000));
    }
    return Math.max(0, wait);
  }

  /** Hands a run to the worker. A failure is harmless: the sweep queues a run that stays `queued`. */
  async enqueue(job: SyncJob): Promise<void> {
    try {
      await this.queue.add('sync', job, {
        jobId: `lead-sync-${job.orgId}-${job.runId}`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
    } catch (err) {
      this.logger.warn({ err, ...job }, 'lead sync not queued; the sweep will queue it');
    }
  }

  // --- the worker ------------------------------------------------------------------------------------------------------------------

  /** Runs a queued run to its end. Every outcome is recorded; whatever the provider does, the run does not stay `running`. */
  async execute(orgId: number, runId: number): Promise<void> {
    await runInOrg(orgId, async () => {
      const claimed = await this.db.txAs({ orgId, userId: null }, async (tx) => {
        if (!(await this.runs.claim(tx, orgId, runId))) return null;
        const run = (await this.runs.byId(tx, orgId, runId))!;
        const source = await this.sources.findById(tx, orgId, run.sourceId);
        return { run, source };
      });
      if (!claimed) return;
      const { run, source } = claimed;

      let result: LeadPullResult = { status: 'failed', error: 'not_supported', progress: ZERO };
      let latest = ZERO;
      try {
        const resolved = source ? await this.registry.resolve(orgId, refOf(source)) : undefined;
        if (source && resolved) {
          let lastWrite = 0;
          result = await resolved.provider.pull({
            orgId,
            source: refOf(source),
            mode: run.kind,
            from: run.rangeFrom,
            to: run.rangeTo,
            progress: async (p) => {
              latest = p;
              if (Date.now() - lastWrite < PROGRESS_EVERY_MS) return;
              lastWrite = Date.now();
              await this.db.txAs({ orgId, userId: null }, (tx) =>
                this.runs.progress(tx, orgId, runId, p),
              );
            },
          });
        }
      } catch (err) {
        this.logger.error({ err, orgId, runId }, 'lead pull crashed');
        result = { status: 'failed', error: 'internal_error', progress: latest };
      }

      const status =
        result.status === 'ok' ? 'done' : result.status === 'failed' ? 'failed' : 'partial';
      const error =
        result.status === 'ok'
          ? null
          : (result.error ?? (status === 'failed' ? 'provider_error' : 'too_soon'));
      await this.db.txAs({ orgId, userId: null }, async (tx) => {
        await this.runs.finish(tx, orgId, runId, { status, error, progress: result.progress });
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: runId,
          action: 'update',
          delta: {
            status: { old: 'running', new: status },
            ...(error ? { error: { old: null, new: error } } : {}),
          },
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'leads',
          aggregateId: runId,
          eventType: 'lead.sync.finished',
          orgId,
          payload: {
            runId: run.uuid,
            leadSourceId: run.sourceUuid,
            kind: run.kind,
            status,
            error,
            fetched: result.progress.fetched,
            accepted: result.progress.accepted,
            duplicates: result.progress.duplicates,
            failed: result.progress.failed,
          },
        });
      });
    });
  }
}
