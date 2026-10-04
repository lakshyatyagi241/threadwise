import type { MarketUsageRow } from '@crm/contracts';

export const USAGE_SORTS = ['failed', 'installs', 'name'] as const;
export type UsageSort = (typeof USAGE_SORTS)[number];

export type UsageReason = 'installErrors' | 'needsReauth' | 'failed24h' | 'failed7d';

export interface UsageFlags {
  /** True when the row is "Needs a look": an installation in error or needing sign-in again, or any failed delivery. */
  needsLook: boolean;
  reasons: UsageReason[];
  /** Installations whose health is `error` or `needs_reauth`. */
  brokenInstalls: number;
  /**
   * Runbook section 8: an integration with failing installations or deliveries is breaking, a portal changed its format or a key expired;
   * the fix is a new version of the recipe. A mini app has no recipe, so it gets no such hint.
   */
  recipeMayBeBreaking: boolean;
}

export function usageFlags(row: MarketUsageRow): UsageFlags {
  const reasons: UsageReason[] = [];
  if (row.health.error > 0) reasons.push('installErrors');
  if (row.health.needsReauth > 0) reasons.push('needsReauth');
  if (row.events.last24h.failed > 0) reasons.push('failed24h');
  if (row.events.last7d.failed > 0) reasons.push('failed7d');
  const needsLook = reasons.length > 0;
  return {
    needsLook,
    reasons,
    brokenInstalls: row.health.error + row.health.needsReauth,
    recipeMayBeBreaking: needsLook && row.kind === 'integration',
  };
}

const byName = (a: MarketUsageRow, b: MarketUsageRow) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.slug.localeCompare(b.slug);

/** A sorted copy: `failed` is most failed deliveries (7 days, then 24 hours) first, `installs` most installations first, `name` A to Z. */
export function sortUsage(rows: readonly MarketUsageRow[], sort: UsageSort): MarketUsageRow[] {
  const copy = [...rows];
  switch (sort) {
    case 'name':
      return copy.sort(byName);
    case 'installs':
      return copy.sort((a, b) => b.installs.total - a.installs.total || byName(a, b));
    case 'failed':
      return copy.sort(
        (a, b) =>
          b.events.last7d.failed - a.events.last7d.failed ||
          b.events.last24h.failed - a.events.last24h.failed ||
          byName(a, b),
      );
  }
}

export interface UsageTotals {
  apps: number;
  installs: number;
  activeInstalls: number;
  needsLook: number;
  failed7d: number;
}

export function usageTotals(rows: readonly MarketUsageRow[]): UsageTotals {
  return rows.reduce<UsageTotals>(
    (t, r) => ({
      apps: t.apps + 1,
      installs: t.installs + r.installs.total,
      activeInstalls: t.activeInstalls + r.installs.active,
      needsLook: t.needsLook + (usageFlags(r).needsLook ? 1 : 0),
      failed7d: t.failed7d + r.events.last7d.failed,
    }),
    { apps: 0, installs: 0, activeInstalls: 0, needsLook: 0, failed7d: 0 },
  );
}
