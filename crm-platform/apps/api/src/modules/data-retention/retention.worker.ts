import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { RetentionItemId } from '@crm/contracts';
import type { Env } from '../../config/env.schema';
import {
  ARCHIVE_STORAGE,
  type ArchiveStorage,
} from '../../infra/providers/data-retention/archive-storage.port';
import { DatabaseService } from '../../infra/db/database.service';
import { parseObjectKey, prefixOf } from './archive-keys';
import { PartitionArchiver, type ArchiveResult } from './partition-archiver.service';
import { loadPolicies, recordRun } from './retention-store';
import {
  RETENTION_POLICIES,
  STREAM_POLICIES,
  isPastLiveWindow,
  type StreamPolicy,
} from './retention-policies';

export interface ExpiryReport {
  /** Months whose archive objects were (or, in a dry run, would be) deleted. */
  months: string[];
  objects: number;
}

export interface StreamReport {
  stream: string;
  /** Dry run only: partitions that would be archived and dropped. */
  wouldArchive?: Array<{ month: string; estimatedRows: number | null; bytes: number }>;
  /** Real run only. */
  archived?: ArchiveResult[];
  expired?: ExpiryReport;
  error?: string;
}

export interface RetentionReport {
  dryRun: boolean;
  streams: StreamReport[];
}

/**
 * The daily retention job (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md, section 6): for every registered stream it
 * archives and drops the partitions past their live window, then deletes archive objects past their archive window.
 *
 * Off until `RETENTION_ENABLED=true`, and with `RETENTION_DRY_RUN` left at its default (true) it only logs what it would do. A failure
 * on one stream is logged and the others still run. Worker process only.
 */
@Injectable()
export class RetentionWorker {
  private readonly logger = new Logger(RetentionWorker.name);
  private running = false;

  constructor(
    private readonly archiver: PartitionArchiver,
    @Inject(ARCHIVE_STORAGE) private readonly storage: ArchiveStorage,
    @Optional() private readonly config?: ConfigService<Env, true>,
    @Optional()
    @Inject(RETENTION_POLICIES)
    private readonly policies: readonly StreamPolicy[] = STREAM_POLICIES,
    @Optional() @Inject(DatabaseService) private readonly db?: Pick<DatabaseService, 'privileged'>,
  ) {}

  /**
   * The registered streams with the days a super admin saved for them (`data_retention_policies`) laid over the built-in ones.
   * A stream marked `optIn` is left out until it has a saved policy. Without a database (a unit test) the registry is used as is.
   */
  async effectivePolicies(): Promise<StreamPolicy[]> {
    if (!this.db) return [...this.policies];
    const saved = await this.db.privileged((tx) => loadPolicies(tx));
    const out: StreamPolicy[] = [];
    for (const policy of this.policies) {
      const mine = saved.get(policy.stream);
      if (!mine) {
        if (!policy.optIn) out.push(policy);
        continue;
      }
      out.push({ ...policy, liveDays: mine.liveDays, archiveDays: mine.archiveDays });
    }
    return out;
  }

  /** Returns the report, or null when the job is off or a run is already in progress. */
  @Cron('50 3 * * *')
  async nightly(): Promise<RetentionReport | null> {
    if (this.config?.get('RETENTION_ENABLED', { infer: true }) !== true) return null;
    if (this.running) {
      this.logger.warn('retention run skipped: the previous run is still going');
      return null;
    }
    const dryRun = this.config.get('RETENTION_DRY_RUN', { infer: true }) !== false;
    // The local driver writes into this container's own disk, which a redeploy erases; dropping a partition after that is data loss.
    if (
      !dryRun &&
      this.config.get('ARCHIVE_DRIVER', { infer: true }) === 'local' &&
      this.config.get('NODE_ENV', { infer: true }) === 'production'
    ) {
      this.logger.error(
        'retention refused: RETENTION_DRY_RUN=false needs ARCHIVE_DRIVER=s3 in production, the local archive is not durable',
      );
      return null;
    }
    this.running = true;
    try {
      return await this.run({ dryRun });
    } catch (err) {
      this.logger.error({ err }, 'retention run failed');
      return null;
    } finally {
      this.running = false;
    }
  }

  async run(opts: { dryRun: boolean; now?: Date }): Promise<RetentionReport> {
    const now = opts.now ?? new Date();
    const streams: StreamReport[] = [];
    for (const policy of await this.effectivePolicies()) {
      const report: StreamReport = { stream: policy.stream };
      try {
        if (opts.dryRun) {
          report.wouldArchive = await this.plan(policy, now);
        } else {
          report.archived = await this.archiver.archiveEligible(policy, { now });
        }
        report.expired = await this.expireArchive(policy, now, opts.dryRun);
      } catch (err) {
        report.error = err instanceof Error ? err.message : String(err);
        this.logger.error({ err, stream: policy.stream }, 'retention failed for stream');
      }
      streams.push(report);
      await this.remember(policy, report, opts.dryRun, now);
      this.logger.log(
        { dryRun: opts.dryRun, ...summary(report) },
        opts.dryRun ? 'retention dry run' : 'retention run finished',
      );
    }
    return { dryRun: opts.dryRun, streams };
  }

  /** Leaves the dashboard's "last run" for the stream. Never fails the run: the numbers are for display. */
  private async remember(
    policy: StreamPolicy,
    report: StreamReport,
    dryRun: boolean,
    now: Date,
  ): Promise<void> {
    if (!this.db) return;
    try {
      const dropped = (report.archived ?? []).filter((r) => r.status === 'dropped');
      const failed = (report.archived ?? []).filter((r) => r.status === 'failed');
      const objects = await this.storage.list(`archive/${policy.stream}/`);
      await this.db.privileged((tx) =>
        recordRun(
          tx,
          policy.stream as RetentionItemId,
          {
            mode: dryRun ? 'dry_run' : 'live',
            outcome: report.error ? 'failed' : failed.length > 0 ? 'partial' : 'ok',
            archivedMonths: dropped.length,
            archivedRows: dropped.reduce((n, r) => n + (r.status === 'dropped' ? r.rows : 0), 0),
            archivedBytes: dropped.reduce((n, r) => n + (r.status === 'dropped' ? r.bytes : 0), 0),
            expiredItems: report.expired?.objects ?? 0,
            error: report.error ?? (failed[0]?.status === 'failed' ? failed[0].reason : null),
            archive: {
              objects: objects.length,
              bytes: objects.reduce((n, o) => n + o.bytes, 0),
            },
          },
          now,
        ),
      );
    } catch (err) {
      this.logger.warn({ err, stream: policy.stream }, 'could not record the retention run');
    }
  }

  private async plan(
    policy: StreamPolicy,
    now: Date,
  ): Promise<NonNullable<StreamReport['wouldArchive']>> {
    const out: NonNullable<StreamReport['wouldArchive']> = [];
    for (const month of await this.archiver.existingMonths(policy)) {
      if (!isPastLiveWindow(month, now, policy.liveDays)) continue;
      const info = await this.archiver.inspect(policy, month);
      if (info) out.push({ month, estimatedRows: info.estimatedRows, bytes: info.bytes });
    }
    return out;
  }

  /**
   * Deletes the archive objects of every month whose end is more than `liveDays + archiveDays` ago (the archive starts when the data
   * leaves the live window). Streams with `archiveDays: null` are never touched. With `dryRun` it only reports.
   */
  async expireArchive(policy: StreamPolicy, now: Date, dryRun = false): Promise<ExpiryReport> {
    if (policy.archiveDays === null) return { months: [], objects: 0 };
    const keep = policy.liveDays + policy.archiveDays;
    const byMonth = new Map<string, number>();
    const root = `archive/${policy.stream}/`;
    for (const object of await this.storage.list(root)) {
      const month = /^(\d{4}-\d{2})\//.exec(object.key.slice(root.length))?.[1];
      if (month) byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
    const months = [...byMonth.keys()].filter((m) => isPastLiveWindow(m, now, keep)).sort();
    // A workspace with a legal hold (BL-295) keeps its archive objects: they are per workspace, and the audit log in them is evidence.
    const held = await this.orgsUnderLegalHold();
    let objects = 0;
    for (const month of months) {
      if (held.size === 0) {
        objects += dryRun
          ? (byMonth.get(month) ?? 0)
          : await this.storage.deletePrefix(prefixOf(policy.stream, month));
        continue;
      }
      let kept = 0;
      for (const object of await this.storage.list(prefixOf(policy.stream, month))) {
        const parsed = parseObjectKey(object.key);
        if (parsed && held.has(parsed.org)) {
          kept += 1;
          continue;
        }
        // The month's manifest and failure notes stay while any held object of the month does.
        if (!parsed) continue;
        if (!dryRun) await this.storage.delete(object.key);
        objects += 1;
      }
      if (kept === 0) {
        if (!dryRun) await this.storage.deletePrefix(prefixOf(policy.stream, month));
      } else {
        this.logger.log(
          { stream: policy.stream, month, keptForLegalHold: kept },
          '[RETENTION] archive objects kept under a legal hold',
        );
      }
    }
    return { months, objects };
  }

  /** The workspaces (as the text of their id, the name an archive object carries) that have any active legal hold, or the operator's. */
  private async orgsUnderLegalHold(): Promise<Set<string>> {
    if (!this.db) return new Set();
    const res = await this.db.privileged((tx) =>
      tx.execute(sql`
        SELECT org_id::text AS org FROM legal_holds
         WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
        UNION
        SELECT id::text FROM organizations WHERE legal_hold`),
    );
    return new Set((res.rows as Array<{ org: string }>).map((r) => r.org));
  }
}

/** The log line for one stream: only the fields that have a value. */
function summary(report: StreamReport): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    stream: report.stream,
    wouldArchive: report.wouldArchive?.map(
      (m) => `${m.month} (about ${m.estimatedRows ?? 'unknown'} rows, ${m.bytes} bytes)`,
    ),
    archived: report.archived?.map((r) => `${r.month}:${r.status}`),
    expiredMonths: report.expired?.months,
    error: report.error,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}
