import { and, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { schema } from '@crm/db';
import type { RecordScope } from '@crm/contracts';
import {
  dateWindowPredicate,
  escapeLike,
  groupsPredicate,
  tagsPredicate,
} from './contact-predicates';

export { escapeLike };

const { contacts, teamMembers } = schema;

/**
 * A contact filter with every uuid already turned into the internal id the SQL needs. Producing one
 * is the service's job (it knows how to answer "that group does not exist"); this file only turns it
 * into WHERE conditions, once, for every caller: the list, the stat tiles, "select all matching" in
 * each bulk action, and the export. Having one builder is what makes those agree.
 */
export interface ResolvedContactFilter {
  q?: string;
  ownerId?: number;
  lifecycleStage?: string;
  includeArchived: boolean;
  groupId?: number;
  noGroup?: boolean;
  tagIds?: number[];
  tagMode: 'any' | 'all';
  imported?: boolean;
  unsubscribed?: boolean;
  source?: string;
  status?: string;
  /** Date windows, both ends inclusive (a bare day covers the whole day, UTC). */
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  lastActivityFrom?: string;
  lastActivityTo?: string;
  /**
   * The compiled rules of a segment (segments/segment-compiler.ts): one more AND condition. Resolved
   * by the filter resolver, never taken from the wire.
   */
  segment?: SQL;
  /** Explicit selection: contacts with these uuids. */
  uuids?: string[];
  /** The rows the user un-ticked after choosing "select all matching". */
  excludeUuids?: string[];
}

/** Record scope as a WHERE condition on `contacts.owner_id`. 'all' adds nothing. */
export function contactScopeCondition(
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  if (scope === 'all') return undefined;
  if (scope === 'own') {
    return actorUserId ? eq(contacts.ownerId, actorUserId) : sql`false`;
  }
  if (!actorUserId) return sql`false`;
  return sql`
    ${contacts.ownerId} IN (
      SELECT tm2.user_id
      FROM ${teamMembers} tm1
      JOIN ${teamMembers} tm2
        ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId}
    )
  `;
}

/** Words of the search box. */
export function searchTokens(q: string): string[] {
  return q.split(/\s+/).filter(Boolean).slice(0, 8);
}

/**
 * One word matches when it is in the name, first or last name, the email or the phone, or, for a
 * word that looks like a number, in the digits of the phone ("9812" finds "+91 98123 45678").
 * Every word has to match: "Sharma Aarav" finds "Aarav Sharma".
 */
export function tokenCondition(token: string): SQL {
  const like = `%${escapeLike(token)}%`;
  const parts: SQL[] = [
    sql`${contacts.name} ILIKE ${like}`,
    sql`${contacts.firstName} ILIKE ${like}`,
    sql`${contacts.lastName} ILIKE ${like}`,
    sql`${contacts.email}::text ILIKE ${like}`,
    sql`${contacts.phone} ILIKE ${like}`,
  ];
  const digits = token.replace(/\D/g, '');
  if (digits.length >= 3 && /^[\d+\-().]+$/.test(token)) {
    parts.push(sql`${contacts.normalizedPhone} ILIKE ${`%${digits}%`}`);
  }
  return sql`(${sql.join(parts, sql` OR `)})`;
}

export function contactConditions(
  orgId: number,
  f: ResolvedContactFilter,
  scope: SQL | undefined,
): SQL[] {
  const c: SQL[] = [eq(contacts.orgId, orgId)];

  if (!f.includeArchived) c.push(eq(contacts.isArchived, false));
  if (f.ownerId !== undefined) c.push(eq(contacts.ownerId, f.ownerId));
  if (f.lifecycleStage) c.push(eq(contacts.lifecycleStage, f.lifecycleStage));
  if (f.status) c.push(eq(contacts.status, f.status));
  if (f.source) c.push(eq(contacts.source, f.source));
  if (f.q) for (const token of searchTokens(f.q)) c.push(tokenCondition(token));

  if (f.groupId !== undefined)
    c.push(groupsPredicate(orgId, sql`${contacts.id}`, 'has_any', [f.groupId]));
  if (f.noGroup) c.push(groupsPredicate(orgId, sql`${contacts.id}`, 'is_empty', []));

  if (f.tagIds && f.tagIds.length > 0) {
    c.push(
      tagsPredicate(
        orgId,
        sql`${contacts.id}`,
        f.tagMode === 'all' ? 'has_all' : 'has_any',
        f.tagIds,
      ),
    );
  }

  for (const [column, from, to] of [
    [contacts.createdAt, f.createdFrom, f.createdTo],
    [contacts.updatedAt, f.updatedFrom, f.updatedTo],
    [contacts.lastActivityAt, f.lastActivityFrom, f.lastActivityTo],
  ] as const) {
    const window = dateWindowPredicate(sql`${column}`, from, to);
    if (window) c.push(window);
  }
  if (f.segment) c.push(f.segment);

  if (f.imported !== undefined) {
    c.push(
      f.imported ? sql`${contacts.importJobId} IS NOT NULL` : sql`${contacts.importJobId} IS NULL`,
    );
  }
  if (f.unsubscribed !== undefined) c.push(eq(contacts.isUnsubscribed, f.unsubscribed));

  if (f.uuids) c.push(f.uuids.length > 0 ? inArray(contacts.uuid, f.uuids) : sql`false`);
  if (f.excludeUuids && f.excludeUuids.length > 0)
    c.push(notInArray(contacts.uuid, f.excludeUuids));

  if (scope) c.push(scope);
  return c;
}

export const whereOf = (conditions: SQL[]): SQL => and(...conditions) ?? sql`true`;
