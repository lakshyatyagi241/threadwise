import type { SyncTemplatesResult, WabaConnection } from '@crm/contracts';

export interface SyncTotals {
  created: number;
  updated: number;
  missing: number;
  total: number;
  /** Numbers whose sync failed (the others still count). */
  failed: number;
  succeeded: number;
}

/** Reference loops every connected account: one failing account is reported, the good ones still count. */
export function summarizeSync(results: Array<SyncTemplatesResult | null>): SyncTotals {
  const t: SyncTotals = { created: 0, updated: 0, missing: 0, total: 0, failed: 0, succeeded: 0 };
  for (const r of results) {
    if (!r) {
      t.failed += 1;
      continue;
    }
    t.succeeded += 1;
    t.created += r.created;
    t.updated += r.updated;
    t.missing += r.missing;
    t.total += r.total;
  }
  return t;
}

/** Which numbers a sync runs against: the filtered one, else every connected number. */
export function syncTargets(
  connections: WabaConnection[],
  connectionId: string | undefined,
): string[] {
  if (connectionId) return connections.some((c) => c.id === connectionId) ? [connectionId] : [];
  return usableConnections(connections).map((c) => c.id);
}

/** Numbers a template can be submitted or synced through: connected, with a token stored. */
export const usableConnections = (connections: WabaConnection[]): WabaConnection[] =>
  connections.filter((c) => c.status === 'connected' && c.hasToken);

/** A readable name for a number: its label, else the phone number, else the verified name. */
export function connectionLabel(
  c: Pick<WabaConnection, 'displayLabel' | 'phoneNumber' | 'verifiedName'>,
): string {
  return c.displayLabel || c.phoneNumber || c.verifiedName || '';
}
