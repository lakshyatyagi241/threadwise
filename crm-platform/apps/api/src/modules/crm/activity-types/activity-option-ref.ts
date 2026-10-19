import { sql, type SQL } from 'drizzle-orm';
import type { ActivityOptionRef } from '@crm/contracts';

/**
 * How a record that holds a task type or an outcome reads it back. The columns come from a LEFT JOIN to `activity_type_options` (alias
 * `opt`) and `activity_types` (alias `act`); the option is read even when it was removed from the list, so an old record keeps its outcome.
 * `prefix` keeps two options on one row (a task's type and its outcome) apart.
 */
export function optionRefColumns(opt: string, act: string, prefix: string): SQL {
  const o = sql.raw(opt);
  const a = sql.raw(act);
  const p = (name: string) => sql.raw(`${prefix}_${name}`);
  return sql`${o}.uuid AS ${p('uuid')}, ${o}.key AS ${p('key')}, ${o}.name AS ${p('name')}, ${o}.is_system AS ${p('system')},
    ${a}.key AS ${p('activity')}, (${o}.deleted_at IS NOT NULL) AS ${p('removed')}`;
}

type Raw = Record<string, unknown>;

/** The reference in a row read with `optionRefColumns`, or null when the record holds none. */
export function optionRefFrom(r: Raw, prefix: string): ActivityOptionRef | null {
  const uuid = r[`${prefix}_uuid`];
  if (uuid === null || uuid === undefined) return null;
  return {
    id: uuid as string,
    key: r[`${prefix}_key`] as string,
    name: (r[`${prefix}_name`] as string | null) ?? null,
    isSystem: r[`${prefix}_system`] as boolean,
    activityKey: r[`${prefix}_activity`] as string,
    removed: r[`${prefix}_removed`] as boolean,
  };
}
