import type { SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { InvalidCondition, SegmentGroup } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { compileRules, collectRuleRefs } from './segment-compiler';
import { loadRuleContext } from './segment-rule-context';
import { SegmentsRepository, type SegmentRow } from './segments.repository';

/** The caller's relationship to segments, read from the grants the permission guard resolved. */
export interface SegmentAccess {
  /** Holds record.segments.read. */
  canRead: boolean;
  userId: number | null;
  /** Holds record.segments.update with scope `all`: sees private segments of others and edits any. */
  manageAll: boolean;
}

/**
 * Fails closed: a context without grants (anything that is not a guarded HTTP request) sees no
 * segment. A background job that acts for a request somebody already authorized builds its context
 * with explicit grants (see SegmentActionsProcessor); other domains resolving an audience call
 * SegmentsService.resolveMembers, which does not go through visibility at all.
 */
export function currentSegmentAccess(): SegmentAccess {
  const ctx = RequestContextStore.require();
  const read = ctx.grants?.get('record.segments.read');
  const update = ctx.grants?.get('record.segments.update');
  return {
    canRead: read?.effect === 'allow',
    userId: ctx.userId,
    manageAll: update?.effect === 'allow' && update.scope === 'all',
  };
}

export const canSee = (row: SegmentRow, a: SegmentAccess): boolean =>
  a.canRead &&
  (a.manageAll || row.visibility === 'shared' || (a.userId !== null && row.ownerId === a.userId));

const repo = new SegmentsRepository();

export interface SegmentFilter {
  segmentId: number;
  uuid: string;
  /** The rules as a condition over `contacts`, for ContactFilter.segment. */
  where: SQL;
  invalid: InvalidCondition[];
}

/**
 * `segmentId` in a contact filter: loads the segment (undefined when it does not exist or the
 * caller may not see it, which the resolver answers with "no contacts", the same as any unknown id
 * in a filter) and compiles its rules against the workspace as it is now.
 */
export async function loadSegmentFilter(
  tx: Tx,
  orgId: number,
  uuid: string,
): Promise<SegmentFilter | undefined> {
  const row = await repo.findByUuid(tx, orgId, uuid);
  if (!row || !canSee(row, currentSegmentAccess())) return undefined;
  const filter = await compileSegment(tx, orgId, row);
  await repo.markUsed(tx, orgId, row.id);
  return filter;
}

export async function compileSegment(
  tx: Tx,
  orgId: number,
  row: SegmentRow,
): Promise<SegmentFilter> {
  const rules = row.rules as unknown as SegmentGroup;
  const rc = await loadRuleContext(tx, orgId, collectRuleRefs(rules));
  const compiled = compileRules(orgId, rules, rc);
  return { segmentId: row.id, uuid: row.uuid, where: compiled.where, invalid: compiled.invalid };
}
