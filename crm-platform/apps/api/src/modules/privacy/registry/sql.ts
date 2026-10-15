import { sql, type SQL } from 'drizzle-orm';
import type { Link, Replacement, ResolvedSubject, TableSpec } from './types';

/** The visible tombstone written over a personal text value that must stay present (a NOT NULL column, a record kept by legal hold). */
export const TOMBSTONE = '[erased]';

/** Numbers come from our own queries, so the literal is safe; it travels as one parameter. */
export const bigintArray = (ids: readonly number[]): SQL => sql`${`{${ids.join(',')}}`}::bigint[]`;
const uuidArray = (ids: readonly string[]): SQL => sql`${`{${ids.join(',')}}`}::uuid[]`;
/** Text values are user data: they travel as a JSON document, never spliced into the statement. */
const textArray = (xs: readonly string[]): SQL =>
  sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(xs)}::jsonb))`;

/** The condition that selects a table's rows of the person. `FALSE` when the person has nothing to match. */
export function linkPredicate(link: Link | readonly Link[], subject: ResolvedSubject): SQL {
  if (Array.isArray(link)) {
    const parts = (link as readonly Link[]).map((l) => linkPredicate(l, subject));
    return sql`(${sql.join(parts, sql` OR `)})`;
  }
  const one = link as Link;
  return singleLink(one, subject);
}

function singleLink(link: Link, subject: ResolvedSubject): SQL {
  const col = sql.identifier(link.column);
  switch (link.by) {
    case 'custom':
      return link.predicate(subject);
    case 'via':
      return sql`${col} IN (SELECT ${sql.identifier(link.key)} FROM ${sql.identifier(link.table)} WHERE org_id = ${subject.orgId} AND (${linkPredicate(link.link, subject)}))`;
    case 'self':
    case 'contact':
      return subject.contactIds.length
        ? sql`${col} = ANY(${bigintArray(subject.contactIds)})`
        : sql`FALSE`;
    case 'contact_uuid':
      return subject.contactUuids.length
        ? sql`${col} = ANY(${uuidArray(subject.contactUuids)})`
        : sql`FALSE`;
    case 'lead':
      return subject.leadIds.length
        ? sql`${col} = ANY(${bigintArray(subject.leadIds)})`
        : sql`FALSE`;
    case 'conversation':
      return subject.conversationIds.length
        ? sql`${col} = ANY(${bigintArray(subject.conversationIds)})`
        : sql`FALSE`;
    case 'conversation_uuid':
      return subject.conversationUuids.length
        ? sql`${col} = ANY(${uuidArray(subject.conversationUuids)})`
        : sql`FALSE`;
    case 'message':
      return subject.conversationIds.length
        ? sql`${col} IN (SELECT m.id FROM messages m WHERE m.org_id = ${subject.orgId} AND m.conversation_id = ANY(${bigintArray(subject.conversationIds)}))`
        : sql`FALSE`;
    case 'phone':
      return subject.phoneDigits.length
        ? sql`regexp_replace(${col}::text, '\\D', '', 'g') = ANY(${textArray(subject.phoneDigits)})`
        : sql`FALSE`;
    case 'email':
      return subject.emails.length
        ? sql`lower(${col}::text) = ANY(${textArray(subject.emails)})`
        : sql`FALSE`;
  }
}

/** `org_id = $1 AND (link) [AND where]` for one table spec. */
export function rowsOf(spec: TableSpec, subject: ResolvedSubject): SQL {
  const extra = spec.where ? sql` AND (${spec.where})` : sql``;
  return sql`org_id = ${subject.orgId} AND (${linkPredicate(spec.link, subject)})${extra}`;
}

export function replacementSql(r: Replacement): SQL {
  if (typeof r === 'object') return sql`${r.text}`;
  switch (r) {
    case 'tombstone':
      return sql`${TOMBSTONE}`;
    case 'null':
      return sql`NULL`;
    case 'empty_object':
      return sql`'{}'::jsonb`;
    case 'empty_array':
      return sql`'[]'::jsonb`;
    case 'false':
      return sql`FALSE`;
    case 'now':
      return sql`now()`;
    case 'empty_text':
      return sql`''`;
    case 'erased_uuid':
      return sql`'erased:' || uuid::text`;
  }
}

/** `col = value, col = value` for an UPDATE. */
export function setClause(set: Readonly<Record<string, Replacement>>): SQL {
  return sql.join(
    Object.entries(set).map(([c, r]) => sql`${sql.identifier(c)} = ${replacementSql(r)}`),
    sql`, `,
  );
}

/** Columns that must never leave in an export: sealed tokens, hashes, secrets. */
export const SECRET_COLUMN = /(cipher|hash|secret|token|password|api_key|signature|search_vector)/i;
