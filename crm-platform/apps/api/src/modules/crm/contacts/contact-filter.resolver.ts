import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import type { ContactFilter } from '@crm/contracts';
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

export type FilterResolution = { empty: true } | { empty: false; filter: ResolvedContactFilter };

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
    source: input.source,
    status: input.status,
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

  return { empty: false, filter: resolved };
}
