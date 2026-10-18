import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  STORAGE_LEVELS,
  type StorageCategoryUsage,
  type StorageFleetResponse,
  type StorageFleetWorkspace,
  type StorageLevel,
  type StorageSummary,
  type StorageWorkspaceDetailResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService, PlatformStore } from '../auth';
import { StorageModeService } from './storage-mode.service';
import { StorageQuotaRepository } from './storage-quota.repository';
import { ORPHAN_AFTER_MS, isStorageCategory } from './storage-quota.rules';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;
const num = (v: unknown): number => Number(v ?? 0);
const iso = (v: unknown): string | null => (v ? new Date(String(v)).toISOString() : null);

const TOP = 20;
/** A workspace counts for the "drift" figures when its counter check ran within this window (the nightly run, with margin). */
const DRIFT_WINDOW_HOURS = 36;

/**
 * The operator's READ-ONLY storage view (spec 11.1, phase S1): the fleet (totals, by category, the biggest workspaces, how many are at
 * each level, how far the counters drifted) and one workspace's panel. It reads across workspaces through the platform door
 * (`PlatformStore`, behind `OperatorGuard` and `PlatformPermissionGuard`) and owns no table. Nothing here changes anything: re-running a
 * reconcile, re-evaluating a cap and grants are phases S2 and S4.
 */
@Injectable()
export class StorageFleetService {
  constructor(
    private readonly store: PlatformStore,
    private readonly repo: StorageQuotaRepository,
    private readonly mode: StorageModeService,
    private readonly audit: AuthAuditService,
  ) {}

  async fleet(now: Date = new Date()): Promise<StorageFleetResponse> {
    const configured = await this.mode.configured();
    const data = await this.store.tx(async (tx) => {
      const totals = rowsOf(
        await tx.execute(sql`
          SELECT (SELECT count(*) FROM organizations WHERE status <> 'deleted')::bigint AS workspaces,
                 coalesce((SELECT sum(hot_bytes) FROM storage_org_state), 0)::bigint AS hot,
                 coalesce((SELECT sum(reserved_bytes) FROM storage_org_state), 0)::bigint AS reserved,
                 coalesce((SELECT sum(cold_bytes) FROM storage_usage), 0)::bigint AS cold,
                 coalesce((SELECT sum(objects) FROM storage_usage), 0)::bigint AS objects`),
      )[0]!;
      const byCategory = rowsOf(
        await tx.execute(sql`
          SELECT category, sum(hot_bytes)::bigint AS hot, sum(cold_bytes)::bigint AS cold, sum(objects)::bigint AS objects
          FROM storage_usage GROUP BY category ORDER BY sum(hot_bytes) DESC, category`),
      );
      const top = rowsOf(
        await tx.execute(sql`
          SELECT o.uuid, o.name, o.plan, s.hot_bytes, s.reserved_bytes, s.cap_bytes, s.level, s.last_reconciled_at,
                 coalesce((SELECT sum(u.cold_bytes) FROM storage_usage u WHERE u.org_id = s.org_id), 0)::bigint AS cold
          FROM storage_org_state s JOIN organizations o ON o.id = s.org_id
          WHERE o.status <> 'deleted'
          ORDER BY s.hot_bytes DESC, o.id LIMIT ${TOP}`),
      );
      const levels = rowsOf(
        await tx.execute(sql`SELECT level, count(*)::bigint AS n FROM storage_org_state GROUP BY level`),
      );
      const drift = rowsOf(
        await tx.execute(sql`
          SELECT max(last_reconciled_at) AS last_run,
                 count(*) FILTER (WHERE last_drift_bytes > 0)::bigint AS drifting,
                 coalesce(sum(last_drift_bytes), 0)::bigint AS drift_bytes
          FROM storage_org_state
          WHERE last_reconciled_at >= ${new Date(now.getTime() - DRIFT_WINDOW_HOURS * 3600_000).toISOString()}::timestamptz`),
      )[0]!;
      const lastRun = rowsOf(
        await tx.execute(sql`SELECT max(last_reconciled_at) AS last_run FROM storage_org_state`),
      )[0]!;
      return { totals, byCategory, top, levels, drift, lastRun };
    });

    const levels = Object.fromEntries(STORAGE_LEVELS.map((l) => [l, 0])) as Record<StorageLevel, number>;
    for (const r of data.levels) {
      const level = String(r.level) as StorageLevel;
      if (level in levels) levels[level] = num(r.n);
    }
    return {
      mode: configured,
      generatedAt: now.toISOString(),
      totals: {
        workspaces: num(data.totals.workspaces),
        hotBytes: num(data.totals.hot),
        coldBytes: num(data.totals.cold),
        reservedBytes: num(data.totals.reserved),
        objects: num(data.totals.objects),
      },
      byCategory: data.byCategory.filter((r) => isStorageCategory(String(r.category))).map(toCategoryUsage),
      top: data.top.map(toFleetWorkspace),
      levels,
      drift: {
        lastRunAt: iso(data.lastRun.last_run),
        workspacesWithDrift: num(data.drift.drifting),
        driftBytes: num(data.drift.drift_bytes),
      },
    };
  }

  async workspace(workspaceUuid: string, now: Date = new Date()): Promise<StorageWorkspaceDetailResponse> {
    const configured = await this.mode.configured();
    const found = await this.store.tx(async (tx) => {
      const org = rowsOf(
        await tx.execute(sql`SELECT id, uuid, name, plan FROM organizations WHERE uuid = ${workspaceUuid}::uuid`),
      )[0];
      if (!org) return null;
      const orgId = num(org.id);
      const state = rowsOf(
        await tx.execute(sql`
          SELECT hot_bytes, reserved_bytes, cap_bytes, level, over_since, last_reconciled_at
          FROM storage_org_state WHERE org_id = ${orgId}`),
      )[0];
      const usage = rowsOf(
        await tx.execute(sql`
          SELECT category, hot_bytes AS hot, cold_bytes AS cold, objects FROM storage_usage
          WHERE org_id = ${orgId} ORDER BY hot_bytes DESC, category`),
      );
      const orphans = await this.repo.countOrphanCandidates(
        tx,
        orgId,
        new Date(now.getTime() - ORPHAN_AFTER_MS),
      );
      return { org, state, usage, orphans };
    });
    if (!found) throw AppError.notFound('Workspace', workspaceUuid);

    // Reading one workspace's storage is a cross-tenant read by a person: it leaves a trace (spec 14).
    const ctx = RequestContextStore.peek();
    await this.audit.recordStandalone({
      event: 'platform.storage.workspace_viewed',
      status: 'success',
      actorType: 'platform_operator',
      actorId: ctx?.actorId ?? null,
      payload: { workspace: workspaceUuid },
    });

    const s = found.state;
    const byCategory = found.usage.filter((r) => isStorageCategory(String(r.category))).map(toCategoryUsage);
    const summary: StorageSummary = {
      mode: configured,
      hotBytes: num(s?.hot_bytes),
      reservedBytes: num(s?.reserved_bytes),
      coldBytes: byCategory.reduce((a, c) => a + c.coldBytes, 0),
      capBytes: num(s?.cap_bytes),
      level: (s?.level as StorageLevel | undefined) ?? 'ok',
      overSince: iso(s?.over_since),
      byCategory,
      lastReconciledAt: iso(s?.last_reconciled_at),
    };
    return {
      workspaceId: String(found.org.uuid),
      name: String(found.org.name),
      plan: String(found.org.plan),
      summary,
      orphanCandidates: found.orphans,
    };
  }
}

function toCategoryUsage(r: Row): StorageCategoryUsage {
  return {
    category: String(r.category) as StorageCategoryUsage['category'],
    hotBytes: num(r.hot),
    coldBytes: num(r.cold),
    objects: num(r.objects),
  };
}

function toFleetWorkspace(r: Row): StorageFleetWorkspace {
  return {
    workspaceId: String(r.uuid),
    name: String(r.name),
    plan: String(r.plan),
    hotBytes: num(r.hot_bytes),
    coldBytes: num(r.cold),
    reservedBytes: num(r.reserved_bytes),
    capBytes: num(r.cap_bytes),
    level: String(r.level) as StorageLevel,
    lastReconciledAt: iso(r.last_reconciled_at),
  };
}
