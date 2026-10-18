import { and, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import { schema } from '@crm/db';
import type { FollowUpFilter, RecordScope } from '@crm/contracts';
import {
  dateWindowPredicate,
  escapeLike,
  groupsPredicate,
  NON_DIGIT,
  phoneDigits,
  tagsPredicate,
} from './contact-predicates';

export { escapeLike };

/**
 * The contact's open follow-up stands in `state` (BL-291), cut like the task list's buckets: overdue is before now, today is the rest of the
 * workspace's day, upcoming is later, someday has no date, none has no open follow-up. One lookup on `uq_tasks_open_follow_up` per contact.
 */
export function followUpCondition(state: FollowUpFilter, timeZone: string): SQL {
  const dayEnd = sql`((date_trunc('day', now() AT TIME ZONE ${timeZone}) + interval '1 day') AT TIME ZONE ${timeZone})`;
  const open = (extra: SQL) =>
    sql`EXISTS (SELECT 1 FROM tasks t WHERE t.org_id = ${contacts.orgId} AND t.contact_id = ${contacts.id} AND t.kind = 'follow_up' AND t.status = 'open' AND ${extra})`;
  switch (state) {
    case 'overdue':
      return open(sql`t.due_at < now()`);
    case 'today':
      return open(sql`t.due_at >= now() AND t.due_at < ${dayEnd}`);
    case 'upcoming':
      return open(sql`t.due_at >= ${dayEnd}`);
    case 'someday':
      return open(sql`t.due_at IS NULL`);
    case 'none':
      return sql`NOT ${open(sql`true`)}`;
  }
}

/** The contact is (or is not) flagged as a minor: one primary-key lookup in `contact_privacy_flags` per contact. */
export function minorCondition(isMinor: boolean): SQL {
  const exists = sql`EXISTS (SELECT 1 FROM contact_privacy_flags pf WHERE pf.org_id = ${contacts.orgId} AND pf.contact_id = ${contacts.id} AND pf.is_minor)`;
  return isMinor ? exists : sql`NOT ${exists}`;
}

const { contacts, teamMembers } = schema;

/**
 * The digits of a contact's phone, written exactly as idx_contacts_phone_digits is (and as the broadcast CSV match writes it), so
 * "+91 88751 37569", "+918875137569" and "918875137569" are one key and an equality on it can use the index.
 */
export const contactPhoneDigits: SQL = sql`regexp_replace(coalesce(${contacts.normalizedPhone}, ${contacts.phone}, ''), ${NON_DIGIT}, '', 'g')`;

/**
 * A contact filter with every uuid already turned into the internal id the SQL needs. Producing one
 * is the service's job (it knows how to answer "that group does not exist"); this file only turns it
 * into WHERE conditions, once, for every caller: the list, the stat tiles, "select all matching" in
 * each bulk action, and the export. Having one builder is what makes those agree.
 */
export interface ResolvedContactFilter {
  q?: string;
  ownerId?: number;
  /** Owned by any of `ids`, or (with `unassigned`) by nobody: the owner multi-select of the Contact Hub. */
  ownerAny?: { ids: number[]; unassigned: boolean };
  lifecycleStage?: string;
  includeArchived: boolean;
  groupId?: number;
  noGroup?: boolean;
  tagIds?: number[];
  tagMode: 'any' | 'all';
  imported?: boolean;
  unsubscribed?: boolean;
  /** true: flagged as a minor; false: not flagged (BL-190). */
  minor?: boolean;
  /** true: uncontacted; false: contacted (BL-290). */
  uncontacted?: boolean;
  /** Where the next follow-up stands now, with the workspace zone that cuts "today" (BL-291). */
  followUp?: { state: FollowUpFilter; timeZone: string };
  source?: string;
  status?: string;
  /** BL-193: the stored time zone is this one / no time zone is stored. */
  timezone?: string;
  noTimezone?: boolean;
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
 * word that looks like a number, in the digits of the phone ("9812" finds "+91 98123 45678"; "+91" finds every number that
 * starts with 91).
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
  } else if (digits.length > 0 && token.startsWith('+') && /^[\d+\-().]+$/.test(token)) {
    // "+91" is a country code: the digits of the phone start with it, with or without the "+" in the stored text.
    parts.push(sql`${contactPhoneDigits} LIKE ${`${digits}%`}`);
  }
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * The search box: every word has to match (`tokenCondition`). A search that is a phone number as it is printed on screen
 * ("+91 88751 37569") is also compared as a whole against the digits of the phone, because its words alone cannot find
 * a number stored without spaces: "+91" is two digits (too short to match on digits) and "88751" is not in "+918875137569" as text.
 */
export function searchCondition(q: string): SQL {
  const words = sql`(${sql.join(searchTokens(q).map(tokenCondition), sql` AND `)})`;
  const typed = phoneDigits(q);
  if (typed.length >= 3 && /^[\d\s+\-().]+$/.test(q.trim()) && searchTokens(q).length > 1) {
    return sql`(${words} OR ${contactPhoneDigits} LIKE ${`%${typed}%`})`;
  }
  return words;
}

export function contactConditions(
  orgId: number,
  f: ResolvedContactFilter,
  scope: SQL | undefined,
): SQL[] {
  const c: SQL[] = [eq(contacts.orgId, orgId)];

  if (!f.includeArchived) c.push(eq(contacts.isArchived, false));
  if (f.ownerId !== undefined) c.push(eq(contacts.ownerId, f.ownerId));
  if (f.ownerAny) {
    const parts: SQL[] = [];
    if (f.ownerAny.ids.length > 0) parts.push(inArray(contacts.ownerId, f.ownerAny.ids));
    if (f.ownerAny.unassigned) parts.push(isNull(contacts.ownerId));
    c.push(parts.length > 0 ? sql`(${sql.join(parts, sql` OR `)})` : sql`false`);
  }
  if (f.lifecycleStage) c.push(eq(contacts.lifecycleStage, f.lifecycleStage));
  if (f.status) c.push(eq(contacts.status, f.status));
  if (f.source) c.push(eq(contacts.source, f.source));
  if (f.timezone) c.push(eq(contacts.timezone, f.timezone));
  if (f.noTimezone === true) c.push(isNull(contacts.timezone));
  if (f.q && searchTokens(f.q).length > 0) c.push(searchCondition(f.q));

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
  if (f.minor !== undefined) c.push(minorCondition(f.minor));
  if (f.followUp) c.push(followUpCondition(f.followUp.state, f.followUp.timeZone));
  if (f.uncontacted !== undefined) {
    c.push(
      f.uncontacted
        ? sql`${contacts.uncontactedSince} IS NOT NULL`
        : sql`${contacts.uncontactedSince} IS NULL`,
    );
  }

  if (f.uuids) c.push(f.uuids.length > 0 ? inArray(contacts.uuid, f.uuids) : sql`false`);
  if (f.excludeUuids && f.excludeUuids.length > 0)
    c.push(notInArray(contacts.uuid, f.excludeUuids));

  if (scope) c.push(scope);
  return c;
}

export const whereOf = (conditions: SQL[]): SQL => and(...conditions) ?? sql`true`;
