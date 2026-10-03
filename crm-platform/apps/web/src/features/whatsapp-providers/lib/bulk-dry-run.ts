import type { AssignmentPreview } from '../api/schemas';

type PreviewRow = AssignmentPreview['rows'][number];

export interface DryRunGroups {
  change: PreviewRow[];
  unchanged: PreviewRow[];
  conflicts: PreviewRow[];
  /** Conflicts grouped by their stable code, so the screen can explain each reason once. */
  conflictsByCode: Array<{ code: string; rows: PreviewRow[] }>;
  /** Channels per provider they leave, over the workspaces that will change ("Interakt: 3 workspaces, 12 channels"). */
  leaving: Array<{ label: string; workspaces: number; channels: number }>;
  channelsAffected: number;
  /** The workspaces the real run is sent: only the ones that would change, never a conflicting one. */
  applyIds: string[];
  /** Applying is pointless when nothing would change. Conflicting workspaces are left out, not forced. */
  canApply: boolean;
}

const UNKNOWN_FROM = '';

/** Groups the dry-run rows of a bulk assignment change for the preview. Order inside each group is the server's. */
export function groupDryRun(preview: AssignmentPreview): DryRunGroups {
  const change: PreviewRow[] = [];
  const unchanged: PreviewRow[] = [];
  const conflicts: PreviewRow[] = [];
  for (const r of preview.rows) {
    if (r.outcome === 'change') change.push(r);
    else if (r.outcome === 'unchanged') unchanged.push(r);
    else conflicts.push(r);
  }

  const byCode = new Map<string, PreviewRow[]>();
  for (const r of conflicts) {
    const code = r.conflictCode ?? 'unknown';
    byCode.set(code, [...(byCode.get(code) ?? []), r]);
  }

  const leaving = new Map<string, { workspaces: number; channels: number }>();
  for (const r of change) {
    const label = r.fromProviderLabel ?? UNKNOWN_FROM;
    const cur = leaving.get(label) ?? { workspaces: 0, channels: 0 };
    leaving.set(label, { workspaces: cur.workspaces + 1, channels: cur.channels + r.channelCount });
  }

  return {
    change,
    unchanged,
    conflicts,
    conflictsByCode: [...byCode].map(([code, rows]) => ({ code, rows })),
    leaving: [...leaving].map(([label, v]) => ({ label, ...v })),
    channelsAffected: change.reduce((n, r) => n + r.channelCount, 0),
    applyIds: change.map((r) => r.workspaceId),
    canApply: change.length > 0,
  };
}

/** What the "select all" box does for the rows on screen: all selected, none, or (some selected) clear. */
export function toggleAll(shown: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const allOn = shown.length > 0 && shown.every((id) => selected.has(id));
  const next = new Set(selected);
  for (const id of shown) {
    if (allOn) next.delete(id);
    else next.add(id);
  }
  return next;
}

export function toggleOne(id: string, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
