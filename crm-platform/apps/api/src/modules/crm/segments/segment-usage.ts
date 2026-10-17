import type { Tx } from '@crm/db';
import {
  builtinFieldKind,
  collectConditions,
  customFieldKey,
  isCompanySegmentField,
  type SegmentGroup,
  type SegmentUsageKind,
} from '@crm/contracts';
import { SegmentsRepository, type SegmentRow } from './segments.repository';

const repo = new SegmentsRepository();

/** The thing a condition points at, as `kind` + `ref` (a uuid, a stage or status value, a property key). */
function refsOf(row: SegmentRow): Array<{ kind: SegmentUsageKind; ref: string }> {
  const out: Array<{ kind: SegmentUsageKind; ref: string }> = [];
  for (const { condition: c } of collectConditions(row.rules as unknown as SegmentGroup)) {
    const kind: SegmentUsageKind | undefined =
      c.field === 'tags'
        ? 'tag'
        : c.field === 'groups'
          ? 'group'
          : c.field === 'owner'
            ? 'user'
            : c.field === 'lifecycleStage'
              ? 'stage'
              : c.field === 'status'
                ? 'status'
                : builtinFieldKind(c.field) === undefined
                  ? 'field'
                  : undefined;
    if (!kind) continue;
    if (kind === 'field') {
      // A company property is told apart from a contact property of the same key by its `company.` prefix.
      out.push({ kind, ref: isCompanySegmentField(c.field) ? c.field : customFieldKey(c.field) });
      continue;
    }
    const v = c.value;
    if (v === undefined || (typeof v === 'object' && !Array.isArray(v))) continue;
    for (const item of Array.isArray(v) ? v : [v]) out.push({ kind, ref: String(item) });
  }
  return out;
}

/** Segments (of the whole workspace) whose rules point at `ref`. */
export function segmentsUsing(
  rows: SegmentRow[],
  kind: SegmentUsageKind,
  ref: string,
): SegmentRow[] {
  return rows.filter((r) => refsOf(r).some((x) => x.kind === kind && x.ref === ref));
}

/**
 * How many segments point at each tag / group / stage / status / property / user of the
 * workspace: the warning shown beside "N contacts" before a delete. One read of the (small) set
 * of segments, so adding it to a usage screen costs one query.
 */
export async function segmentUsageCounts(
  tx: Tx,
  orgId: number,
  kind: SegmentUsageKind,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const row of await repo.listAll(tx, orgId)) {
    for (const ref of new Set(
      refsOf(row)
        .filter((x) => x.kind === kind)
        .map((x) => x.ref),
    )) {
      counts.set(ref, (counts.get(ref) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Called by the delete of a tag, group, stage, status or property, inside its transaction: the
 * segments that point at it now have a condition that matches nothing, so their cached counts are
 * dropped (the next read recounts instead of showing a number from before the delete). Returns their
 * names, for the delete's audit row and event.
 */
export async function segmentNamesUsing(
  tx: Tx,
  orgId: number,
  kind: SegmentUsageKind,
  ref: string,
): Promise<string[]> {
  const rows = segmentsUsing(await repo.listAll(tx, orgId), kind, ref);
  await repo.resetCounts(
    tx,
    orgId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => r.name);
}
