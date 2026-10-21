import { sql, type SQL } from 'drizzle-orm';
import { parseDateValue } from '@crm/contracts';

/**
 * The building blocks of every contact condition: one predicate per value kind, taking the column
 * (or expression) it applies to and the already-validated operand. The flat list filter
 * (contact-conditions.ts) and a segment rule (segments/segment-compiler.ts) both end up here, so
 * "created in the last 7 days" or "name contains" is one piece of SQL for the list, the bulk
 * actions, the export and a segment, not four.
 *
 * Every operand is bound as a parameter. Nothing the user typed is ever concatenated into SQL; the
 * only strings spliced in are the fixed fragments of this file.
 */

/** `%` and `_` in what the user typed are text, not wildcards. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const list = (parts: SQL[]): SQL => sql.join(parts, sql`, `);

// --- text ---------------------------------------------------------------------------------------

export type TextOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'in'
  | 'not_in'
  | 'is_empty'
  | 'is_not_empty';

/**
 * Text. `exact` compares as written (stage, status and select values are identifiers); otherwise
 * equality ignores case. "Not" operators include contacts with no value: a contact without a
 * source IS "not from Facebook".
 */
export function textPredicate(
  column: SQL,
  op: TextOperator,
  value: unknown,
  opts: { exact?: boolean } = {},
): SQL {
  const col = sql`(${column})::text`;
  const side = (x: SQL) => (opts.exact ? x : sql`lower(${x})`);
  const operand = (v: unknown) => side(sql`${String(v)}::text`);
  const values = () => list((value as unknown[]).map(operand));

  switch (op) {
    case 'is_empty':
      return sql`(${col} IS NULL OR btrim(${col}) = '')`;
    case 'is_not_empty':
      return sql`(${col} IS NOT NULL AND btrim(${col}) <> '')`;
    case 'equals':
      return sql`${side(col)} = ${operand(value)}`;
    case 'not_equals':
      return sql`(${col} IS NULL OR ${side(col)} <> ${operand(value)})`;
    case 'contains':
      return sql`${col} ILIKE ${`%${escapeLike(String(value))}%`}`;
    case 'not_contains':
      return sql`(${col} IS NULL OR ${col} NOT ILIKE ${`%${escapeLike(String(value))}%`})`;
    case 'starts_with':
      return sql`${col} ILIKE ${`${escapeLike(String(value))}%`}`;
    case 'in':
      return sql`${side(col)} IN (${values()})`;
    case 'not_in':
      return sql`(${col} IS NULL OR ${side(col)} NOT IN (${values()}))`;
  }
}

// --- phone numbers and country codes --------------------------------------------------------------

/**
 * A condition on a field that is shown formatted but stored in its own way: a phone is displayed "+91 88751 37569" and stored
 * "+918875137569", a country code is typed "+91", "91" or "0091". Typing what is on screen must find the contact, so both sides are
 * reduced to the same key (`keyOf` for the typed operand, `keySql` for the stored value) and compared as text.
 *
 * `raw` is the stored column, used for "is empty" and as the fallback when the operand holds nothing to normalise (a letter-only
 * word: it is then compared as written, as for any text field).
 */
function normalizedPredicate(
  keySql: SQL,
  raw: SQL,
  keyOf: (v: unknown) => string,
  op: TextOperator,
  value: unknown,
): SQL {
  if (op === 'is_empty' || op === 'is_not_empty') return textPredicate(raw, op, value);
  const operands = Array.isArray(value) ? (value as unknown[]) : [value];
  const keys = operands.map(keyOf).filter((k) => k !== '');
  if (keys.length === 0) return textPredicate(raw, op, value);
  const key = keys[0]!;
  const has = sql`${keySql} <> ''`;
  switch (op) {
    case 'equals':
      return sql`${keySql} = ${key}`;
    case 'not_equals':
      return sql`(NOT ${has} OR ${keySql} <> ${key})`;
    case 'contains':
      return sql`${keySql} LIKE ${`%${key}%`}`;
    case 'not_contains':
      return sql`(NOT ${has} OR ${keySql} NOT LIKE ${`%${key}%`})`;
    case 'starts_with':
      return sql`${keySql} LIKE ${`${key}%`}`;
    case 'in':
      return sql`${keySql} IN (${list(keys.map((k) => sql`${k}::text`))})`;
    case 'not_in':
      return sql`(NOT ${has} OR ${keySql} NOT IN (${list(keys.map((k) => sql`${k}::text`))}))`;
  }
}

/** The regex literal `'\D'`, inlined (not bound) so an expression index written with it can serve the query. */
export const NON_DIGIT = sql.raw(`'\\D'`);

/** The digits of a typed phone number: "+91 88751-37569" and "(+91) 88751 37569" are both "918875137569". */
export const phoneDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/**
 * `digitsSql` must be the digits of the stored number, written as the contact index writes it
 * (`regexp_replace(coalesce(normalized_phone, phone, ''), '\D', '', 'g')`, idx_contacts_phone_digits).
 */
export function phonePredicate(digitsSql: SQL, raw: SQL, op: TextOperator, value: unknown): SQL {
  return normalizedPredicate(digitsSql, raw, phoneDigits, op, value);
}

/** A country code is its digits without the "+" and the "00" some files carry. Same rule as `countryCodeDigits` in @crm/contracts. */
export const countryCodeKey = (v: unknown): string =>
  String(v ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');

export function countryCodePredicate(raw: SQL, op: TextOperator, value: unknown): SQL {
  const keySql = sql`ltrim(regexp_replace(coalesce((${raw})::text, ''), ${NON_DIGIT}, '', 'g'), '0')`;
  return normalizedPredicate(keySql, raw, countryCodeKey, op, value);
}

// --- numbers ------------------------------------------------------------------------------------

export type NumberOperator =
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'not_in'
  | 'is_empty'
  | 'is_not_empty';

/** `column` must already be numeric (a number column, or `segment_safe_numeric(...)` for a custom property). */
export function numberPredicate(column: SQL, op: NumberOperator, value: unknown): SQL {
  const col = sql`(${column})::numeric`;
  const n = (v: unknown) => sql`${Number(v)}::numeric`;
  switch (op) {
    case 'is_empty':
      return sql`${col} IS NULL`;
    case 'is_not_empty':
      return sql`${col} IS NOT NULL`;
    case 'equals':
      return sql`${col} = ${n(value)}`;
    case 'not_equals':
      return sql`(${col} IS NULL OR ${col} <> ${n(value)})`;
    case 'gt':
      return sql`${col} > ${n(value)}`;
    case 'gte':
      return sql`${col} >= ${n(value)}`;
    case 'lt':
      return sql`${col} < ${n(value)}`;
    case 'lte':
      return sql`${col} <= ${n(value)}`;
    case 'between': {
      const { from, to } = value as { from: number; to: number };
      return sql`${col} BETWEEN ${n(from)} AND ${n(to)}`;
    }
    case 'in':
      return sql`${col} IN (${list((value as unknown[]).map(n))})`;
    case 'not_in':
      return sql`(${col} IS NULL OR ${col} NOT IN (${list((value as unknown[]).map(n))}))`;
  }
}

// --- dates --------------------------------------------------------------------------------------

export type DateOperator =
  | 'equals'
  | 'before'
  | 'after'
  | 'on_or_before'
  | 'on_or_after'
  | 'between'
  | 'in_last_days'
  | 'more_than_days_ago'
  | 'is_empty'
  | 'is_not_empty';

/** Midnight UTC of a `YYYY-MM-DD` day, whatever the session time zone is. */
const dayStart = (day: string, tz: string): SQL => sql`((${day}::date)::timestamp AT TIME ZONE ${tz})`;
const dayEnd = (day: string, tz: string): SQL => sql`(${dayStart(day, tz)} + interval '1 day')`;

/**
 * A bare day covers that whole day in `tz` (UTC unless the caller says so; segments pass the workspace's zone): `before 2026-10-03`
 * is strictly before its first instant, `on_or_before` includes the whole day, `after` starts at the next day. A full instant is
 * compared exactly. `equals` is "on that day".
 */
function bound(
  col: SQL,
  op: 'equals' | 'before' | 'after' | 'on_or_before' | 'on_or_after',
  raw: unknown,
  tz = 'UTC',
): SQL {
  const d = parseDateValue(raw);
  if (!d) return sql`false`; // unreachable after validation; fails closed rather than casting garbage
  const day = d.kind === 'day' ? d.iso : d.iso.slice(0, 10);
  const instant = sql`${d.iso}::timestamptz`;
  if (op === 'equals') return sql`(${col} >= ${dayStart(day, tz)} AND ${col} < ${dayEnd(day, tz)})`;
  if (d.kind === 'day') {
    switch (op) {
      case 'before':
        return sql`${col} < ${dayStart(day, tz)}`;
      case 'on_or_before':
        return sql`${col} < ${dayEnd(day, tz)}`;
      case 'after':
        return sql`${col} >= ${dayEnd(day, tz)}`;
      case 'on_or_after':
        return sql`${col} >= ${dayStart(day, tz)}`;
    }
  }
  switch (op) {
    case 'before':
      return sql`${col} < ${instant}`;
    case 'on_or_before':
      return sql`${col} <= ${instant}`;
    case 'after':
      return sql`${col} > ${instant}`;
    case 'on_or_after':
      return sql`${col} >= ${instant}`;
  }
}

/** `column` must be a timestamptz (a column, or `segment_safe_timestamptz(...)` for a custom property). */
export function datePredicate(column: SQL, op: DateOperator, value: unknown, tz = 'UTC'): SQL {
  const col = sql`(${column})`;
  switch (op) {
    case 'is_empty':
      return sql`${col} IS NULL`;
    case 'is_not_empty':
      return sql`${col} IS NOT NULL`;
    case 'between': {
      const { from, to } = value as { from: string; to: string };
      return sql`(${bound(col, 'on_or_after', from, tz)} AND ${bound(col, 'on_or_before', to, tz)})`;
    }
    case 'in_last_days':
      return sql`(${col} >= now() - make_interval(days => ${Number(value)}::int) AND ${col} <= now())`;
    case 'more_than_days_ago':
      return sql`${col} < now() - make_interval(days => ${Number(value)}::int)`;
    default:
      return bound(col, op, value, tz);
  }
}

/** A from/to window as the flat list filter sends it; either end may be missing. */
export function dateWindowPredicate(column: SQL, from?: string, to?: string): SQL | undefined {
  if (from && to) return datePredicate(column, 'between', { from, to });
  if (from) return datePredicate(column, 'on_or_after', from);
  if (to) return datePredicate(column, 'on_or_before', to);
  return undefined;
}

// --- sets: tags, groups, multi-select values ----------------------------------------------------

export type SetOperator = 'has_any' | 'has_all' | 'has_none' | 'is_empty' | 'is_not_empty';

/**
 * Tags and groups are join tables, so each is "rows of `table` for this contact": `table` is
 * contact_tags / contact_group_members and `key` its member column.
 */
function joinSetPredicate(
  table: 'contact_tags' | 'contact_group_members',
  key: 'tag_id' | 'group_id',
  orgId: number,
  contactId: SQL,
  op: SetOperator,
  ids: number[],
): SQL {
  const t = sql.raw(table);
  const k = sql.raw(key);
  const inList = sql`x.${k} IN (${list(ids.map((id) => sql`${id}::bigint`))})`;
  const any = (extra?: SQL) => sql`EXISTS (
    SELECT 1 FROM ${t} x
    WHERE x.org_id = ${orgId}::bigint AND x.contact_id = ${contactId}${extra ? sql` AND ${extra}` : sql``}
  )`;
  switch (op) {
    case 'is_empty':
      return sql`NOT ${any()}`;
    case 'is_not_empty':
      return any();
    case 'has_any':
      return any(inList);
    case 'has_none':
      return sql`NOT ${any(inList)}`;
    case 'has_all':
      return sql`(
        SELECT count(DISTINCT x.${k}) FROM ${t} x
        WHERE x.org_id = ${orgId}::bigint AND x.contact_id = ${contactId} AND ${inList}
      ) = ${ids.length}`;
  }
}

export const tagsPredicate = (orgId: number, contactId: SQL, op: SetOperator, ids: number[]) =>
  joinSetPredicate('contact_tags', 'tag_id', orgId, contactId, op, ids);

export const groupsPredicate = (orgId: number, contactId: SQL, op: SetOperator, ids: number[]) =>
  joinSetPredicate('contact_group_members', 'group_id', orgId, contactId, op, ids);

/**
 * A multi-select custom property: `value` is a JSON array of strings in contacts.data. A value
 * that is not an array (a hand-edited import) matches nothing but `is_empty`.
 */
export function multiPredicate(jsonValue: SQL, op: SetOperator, values: string[]): SQL {
  const isArray = sql`jsonb_typeof(${jsonValue}) = 'array'`;
  const arr = sql`ARRAY[${list(values.map((v) => sql`${v}::text`))}]::text[]`;
  switch (op) {
    case 'is_empty':
      return sql`(${jsonValue} IS NULL OR jsonb_typeof(${jsonValue}) = 'null' OR (${isArray} AND jsonb_array_length(${jsonValue}) = 0))`;
    case 'is_not_empty':
      return sql`(${isArray} AND jsonb_array_length(${jsonValue}) > 0)`;
    case 'has_any':
      return sql`(${isArray} AND ${jsonValue} ?| ${arr})`;
    case 'has_all':
      return sql`(${isArray} AND ${jsonValue} ?& ${arr})`;
    case 'has_none':
      return sql`NOT (${isArray} AND ${jsonValue} ?| ${arr})`;
  }
}

/** A checkbox / boolean custom property: stored as a JSON boolean, or "true" / "1" text from an import. */
export function booleanTextPredicate(textValue: SQL, wanted: boolean): SQL {
  const truthy = sql`lower(coalesce(${textValue}, '')) IN ('true', 't', '1', 'yes')`;
  return wanted ? truthy : sql`NOT (${truthy})`;
}
