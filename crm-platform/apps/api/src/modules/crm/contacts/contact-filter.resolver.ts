import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import type { ContactFilter } from '@crm/contracts';
import type { InvalidCondition } from '@crm/contracts';
import { compileAdHocRules, loadSegmentFilter } from '../segments/segment-filter';
import type { ResolvedContactFilter } from './contact-conditions';

const { contactGroups, tags, users } = schema;

/**
 * The wire filter carries uuids; the SQL wants internal ids. Resolving them here, once, is the
 * only place a uuid in a filter is trusted: a uuid that is not in this org (or does not exist)
 * resolves to "matches nothing", never to "ignore the condition and match everything", so a stale
 * group or tag in a saved filter cannot widen a bulk delete.
 */
export interface FilterInput extends Omit<ContactFilter, 'tagMode' | 'includeArchived'> {
  includeArchived?: boolean;
  tagMode?: 'any' | 'all';
  /** A single tag, merged into tagIds. */
  tagId?: string;
}

export type FilterResolution =
  | { empty: true }
  | {
      empty: false;
      filter: ResolvedContactFilter;
      /** Set when the filter named a segment: its conditions that point at deleted things (they match nothing). */
      segment?: { id: string; invalidConditions: InvalidCondition[] };
    };

export async function resolveContactFilter(
  tx: Tx,
  orgId: number,
  input: FilterInput,
  extra: { uuids?: string[]; excludeUuids?: string[] } = {},
): Promise<FilterResolution> {
  const resolved: ResolvedContactFilter = {
    q: input.q,
    lifecycleStage: input.lifecycleStage,
    includeArchived: input.includeArchived ?? false,
    noGroup: input.noGroup,
    tagMode: input.tagMode ?? 'any',
    imported: input.imported,
    unsubscribed: input.unsubscribed,
    subscribed: input.subscribed,
    minor: input.minor,
    uncontacted: input.uncontacted,
    source: input.source,
    status: input.status,
    timezone: input.timezone,
    noTimezone: input.noTimezone,
    createdFrom: input.createdFrom,
    createdTo: input.createdTo,
    updatedFrom: input.updatedFrom,
    updatedTo: input.updatedTo,
    lastActivityFrom: input.lastActivityFrom,
    lastActivityTo: input.lastActivityTo,
    uuids: extra.uuids,
    excludeUuids: extra.excludeUuids,
  };

  if (input.ownerId) {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.uuid, input.ownerId)));
    if (!rows[0]) return { empty: true };
    resolved.ownerId = rows[0].id;
  }

  const ownerUuids = [...new Set(input.ownerIds ?? [])];
  if (ownerUuids.length > 0 || input.unassigned) {
    const rows =
      ownerUuids.length > 0
        ? await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.orgId, orgId), inArray(users.uuid, ownerUuids)))
        : [];
    // Unknown people simply own nothing; when none is known and "nobody" is not asked for, nothing can match.
    if (rows.length === 0 && !input.unassigned) return { empty: true };
    resolved.ownerAny = { ids: rows.map((r) => r.id), unassigned: input.unassigned === true };
  }

  if (input.groupId) {
    const rows = await tx
      .select({ id: contactGroups.id })
      .from(contactGroups)
      .where(and(eq(contactGroups.orgId, orgId), eq(contactGroups.uuid, input.groupId)));
    if (!rows[0]) return { empty: true };
    resolved.groupId = rows[0].id;
  }

  const tagUuids = [...new Set([...(input.tagIds ?? []), ...(input.tagId ? [input.tagId] : [])])];
  if (tagUuids.length > 0) {
    const rows = await tx
      .select({ id: tags.id, uuid: tags.uuid })
      .from(tags)
      .where(and(eq(tags.orgId, orgId), inArray(tags.uuid, tagUuids)));
    // "all of these tags" with a tag that does not exist can never be true; "any of" just
    // ignores the unknown ones, and matches nothing when none is known.
    if (rows.length === 0 || (resolved.tagMode === 'all' && rows.length !== tagUuids.length)) {
      return { empty: true };
    }
    resolved.tagIds = rows.map((r) => r.id);
  }

  let segment: { id: string; invalidConditions: InvalidCondition[] } | undefined;
  if (input.segmentId) {
    // A segment the caller cannot see, or that does not exist, is "no contacts", like any unknown id above.
    const loaded = await loadSegmentFilter(tx, orgId, input.segmentId);
    if (!loaded) return { empty: true };
    resolved.segment = loaded.where;
    segment = { id: loaded.uuid, invalidConditions: loaded.invalid };
  }

  if (input.rules) {
    // The Hub's own conditions narrow further: ANDed with a chosen segment's rules when both are present.
    const adHoc = await compileAdHocRules(tx, orgId, input.rules);
    resolved.segment = resolved.segment
      ? sql`(${resolved.segment}) AND (${adHoc.where})`
      : adHoc.where;
    if (adHoc.invalid.length > 0) {
      segment = {
        id: segment?.id ?? '',
        invalidConditions: [...(segment?.invalidConditions ?? []), ...adHoc.invalid],
      };
    }
  }

  return { empty: false, filter: resolved, ...(segment ? { segment } : {}) };
}
