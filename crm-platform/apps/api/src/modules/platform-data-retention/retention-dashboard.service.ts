import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  RETENTION_AUDIT_EVENTS,
  RETENTION_ITEMS,
  retentionDeleteAfterDays,
  retentionCrossProblem,
  retentionProblem,
  retentionSpecOf,
  type RetentionItemId,
  type RetentionItemSpec,
  type RetentionItemView,
  type RetentionOverview,
  type RetentionPreview,
  type RetentionPreviewRequest,
  type RetentionSaveRequest,
  type RetentionValues,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { retentionConfig } from '../../config/domains/notifications.env';
import { DatabaseService } from '../../infra/db/database.service';
import {
  ARCHIVE_STORAGE,
  type ArchiveStorage,
} from '../../infra/providers/data-retention/archive-storage.port';
import { AuthAuditService } from '../auth';
import {
  countArchiveDaysOlderThan,
  countOlderThan,
  dbArchiveStats,
  deletePolicy,
  engineState,
  isPastLiveWindow,
  liveStats,
  loadPolicies,
  loadRuns,
  partitionSizes,
  savePolicy,
  type StoredPolicy,
} from '../data-retention';

/**
 * The retention dashboard of the operator console: what each data item keeps live and archived, what the last run did, and the writes
 * that change it. Nothing here deletes data. A saved policy is carried out later by the nightly jobs (the archive job for the
 * partitioned items, the auth maintenance sweep and the export sweep for the others), and the items keep their built-in behaviour
 * until a policy is saved for them.
 */
@Injectable()
export class RetentionDashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuthAuditService,
    private readonly config: ConfigService<Env, true>,
    @Inject(ARCHIVE_STORAGE) private readonly storage: ArchiveStorage,
  ) {}

  async overview(): Promise<RetentionOverview> {
    const engine = engineState(this.config);
    const items = await this.db.privileged(async (tx) => {
      const [saved, runs, defaults] = await Promise.all([
        loadPolicies(tx),
        loadRuns(tx),
        this.defaultsFor(tx),
      ]);
      const out: RetentionItemView[] = [];
      for (const spec of RETENTION_ITEMS) {
        out.push(
          this.view(spec, saved.get(spec.id) ?? null, defaults[spec.id], {
            live: await liveStats(tx, spec.id),
            run: runs.get(spec.id) ?? null,
            engineLive: engine.live,
            dbArchive: await dbArchiveStats(tx, spec.id),
          }),
        );
      }
      return out;
    });
    return {
      engine: {
        enabled: engine.enabled,
        dryRun: engine.dryRun,
        archiveDriver: engine.archiveDriver,
        archiveDurable: engine.archiveDurable,
      },
      items,
    };
  }

  async save(
    id: RetentionItemId,
    body: RetentionSaveRequest,
    operatorId: number,
  ): Promise<RetentionItemView> {
    const values: RetentionValues = { liveDays: body.liveDays, archiveDays: body.archiveDays };
    const problem = retentionProblem(id, values);
    if (problem) throw AppError.validation(problem, [{ path: 'liveDays', message: problem }]);

    await this.db.privileged(async (tx) => {
      const defaults = await this.defaultsFor(tx);
      const policies = await loadPolicies(tx);
      const was = policies.get(id) ?? null;
      const cross = retentionCrossProblem(id, values, {
        notificationsRead:
          id === 'notifications_read'
            ? values.liveDays
            : (policies.get('notifications_read')?.liveDays ??
              defaults.notifications_read.liveDays),
        notificationsUnread:
          id === 'notifications_unread'
            ? values.liveDays
            : (policies.get('notifications_unread')?.liveDays ??
              defaults.notifications_unread.liveDays),
      });
      if (cross) throw AppError.validation(cross, [{ path: 'liveDays', message: cross }]);
      // A client that never saw a policy sends null; one that did must send its version. A mismatch either way is a conflict.
      if ((was === null) !== (body.rowVersion === null)) {
        throw AppError.rowVersionConflict('Retention policy');
      }
      const saved = await savePolicy(tx, id, values, body.rowVersion, operatorId);
      await this.audit.record(tx, {
        event: RETENTION_AUDIT_EVENTS.updated,
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          item: id,
          before: was
            ? { liveDays: was.liveDays, archiveDays: was.archiveDays, source: 'custom' }
            : { ...defaults[id], source: 'default' },
          after: { liveDays: saved.liveDays, archiveDays: saved.archiveDays, source: 'custom' },
          rowVersion: saved.rowVersion,
        },
      });
    });
    return this.one(id);
  }

  /** Back to the built-in behaviour of the item. Safe to repeat. */
  async reset(id: RetentionItemId, operatorId: number): Promise<RetentionItemView> {
    await this.db.privileged(async (tx) => {
      const was = await deletePolicy(tx, id);
      if (!was) return;
      await this.audit.record(tx, {
        event: RETENTION_AUDIT_EVENTS.reset,
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          item: id,
          before: { liveDays: was.liveDays, archiveDays: was.archiveDays, source: 'custom' },
          after: { source: 'default' },
        },
      });
    });
    return this.one(id);
  }

  /**
   * What the next run would do with the values in `body`, without saving them: the months that would leave the database for the
   * archive, the archived months that would be deleted for good, or the rows and files that would be deleted.
   */
  async preview(id: RetentionItemId, body: RetentionPreviewRequest): Promise<RetentionPreview> {
    const values: RetentionValues = { liveDays: body.liveDays, archiveDays: body.archiveDays };
    const problem = retentionProblem(id, values);
    if (problem) throw AppError.validation(problem, [{ path: 'liveDays', message: problem }]);
    const spec = retentionSpecOf(id);
    const now = new Date();

    if (spec.kind === 'partitioned') {
      const sizes = await this.db.privileged((tx) => partitionSizes(tx, id));
      const toArchive = sizes.filter((p) => isPastLiveWindow(p.month, now, values.liveDays));
      let toDeleteFromArchive: string[] = [];
      if (values.archiveDays !== null) {
        const keep = values.liveDays + values.archiveDays;
        const dirs = await this.storage.listDirs(`archive/${id}/`);
        toDeleteFromArchive = dirs
          .map((d) => /(\d{4}-\d{2})\/$/.exec(d)?.[1])
          .filter((m): m is string => !!m && isPastLiveWindow(m, now, keep))
          .sort();
      }
      return { id, toArchive, toDeleteFromArchive, rowsToDelete: null };
    }
    if (spec.kind === 'daily_archive') {
      // Live events older than the live window move into the archive; archived days older than live + archive days are deleted.
      const [rowsToArchive, rowsToDelete] = await this.db.privileged(async (tx) => [
        await countOlderThan(tx, id, values.liveDays),
        values.archiveDays === null
          ? 0
          : await countArchiveDaysOlderThan(tx, values.liveDays + values.archiveDays),
      ]);
      return { id, toArchive: [], toDeleteFromArchive: [], rowsToDelete, rowsToArchive };
    }
    const rowsToDelete = await this.db.privileged((tx) => countOlderThan(tx, id, values.liveDays));
    return { id, toArchive: [], toDeleteFromArchive: [], rowsToDelete };
  }

  private async one(id: RetentionItemId): Promise<RetentionItemView> {
    const overview = await this.overview();
    return overview.items.find((i) => i.id === id)!;
  }

  /**
   * What each item does with no saved policy. For the audit log and the security log that is the platform security policy's number
   * (365 when it was never saved; 0 means "keep for ever" and is passed on as 0).
   */
  private async defaultsFor(tx: Tx): Promise<Record<RetentionItemId, RetentionValues>> {
    const res = await tx.execute(
      sql`SELECT (value ->> 'auditLogRetentionDays')::int AS days FROM platform_settings WHERE key = 'security.policy'`,
    );
    const days = (res.rows[0] as { days: number | null } | undefined)?.days;
    // The AI lead scoring settings carry their own retention (90 when never saved); it is the default of the scoring log.
    const scoring = await tx.execute(
      sql`SELECT (value ->> 'retentionDays')::int AS days FROM platform_settings WHERE key = 'lead_scoring.config'`,
    );
    const scoringDays = (scoring.rows[0] as { days: number | null } | undefined)?.days;
    const notify = retentionConfig();
    const out = {} as Record<RetentionItemId, RetentionValues>;
    for (const spec of RETENTION_ITEMS) {
      out[spec.id] = { ...spec.defaults };
      if (
        (spec.id === 'audit_log' || spec.id === 'security_events') &&
        days !== null &&
        days !== undefined
      ) {
        out[spec.id] = { liveDays: days, archiveDays: null };
      }
      if (spec.id === 'lead_scoring_runs' && scoringDays !== null && scoringDays !== undefined) {
        out[spec.id] = { liveDays: scoringDays, archiveDays: null };
      }
      // The bell feed's built-in windows come from the environment (NOTIFY_RETENTION_READ_DAYS / _UNREAD_DAYS).
      if (spec.id === 'notifications_read') {
        out[spec.id] = { liveDays: notify.readDays, archiveDays: null };
      }
      if (spec.id === 'notifications_unread') {
        out[spec.id] = { liveDays: notify.unreadDays, archiveDays: null };
      }
    }
    return out;
  }

  /**
   * Whether a saved value is being carried out now. Partitioned items need the archive job switched on and not in dry-run; the bell feed's
   * sweep has its own switch (NOTIFY_RETENTION_ENABLED); every other sweep always runs.
   */
  private isApplied(spec: RetentionItemSpec, engineLive: boolean): boolean {
    if (spec.kind === 'partitioned') return engineLive;
    if (spec.id === 'notifications_read' || spec.id === 'notifications_unread') {
      return retentionConfig().enabled;
    }
    return true;
  }

  private view(
    spec: RetentionItemSpec,
    saved: StoredPolicy | null,
    fallback: RetentionValues,
    extra: {
      live: RetentionItemView['live'];
      run: Awaited<ReturnType<typeof loadRuns>> extends Map<string, infer R> ? R | null : never;
      engineLive: boolean;
      dbArchive: { objects: number; bytes: number } | null;
    },
  ): RetentionItemView {
    const values: RetentionValues = saved
      ? { liveDays: saved.liveDays, archiveDays: saved.archiveDays }
      : fallback;
    const { run } = extra;
    return {
      id: spec.id,
      kind: spec.kind,
      group: spec.group,
      canArchive: spec.canArchive,
      source: saved ? 'custom' : 'default',
      liveDays: values.liveDays,
      archiveDays: values.archiveDays,
      deleteAfterDays: retentionDeleteAfterDays(values),
      defaults: fallback,
      limits: { live: spec.live, archive: spec.archive },
      rowVersion: saved?.rowVersion ?? null,
      updatedAt: saved?.updatedAt.toISOString() ?? null,
      // Partitioned items are cut by the archive job, which only does real work when it is switched on and not in dry-run.
      applied: !saved || this.isApplied(spec, extra.engineLive),
      live: extra.live,
      archive: extra.dbArchive
        ? { ...extra.dbArchive, measuredAt: new Date().toISOString() }
        : spec.canArchive
          ? (run?.archive ?? null)
          : null,
      lastRun: run
        ? {
            at: run.at,
            mode: run.mode,
            outcome: run.outcome,
            archivedMonths: run.archivedMonths,
            archivedRows: run.archivedRows,
            archivedBytes: run.archivedBytes,
            expiredItems: run.expiredItems,
            deletedRows: run.deletedRows,
            error: run.error,
          }
        : null,
    };
  }
}
