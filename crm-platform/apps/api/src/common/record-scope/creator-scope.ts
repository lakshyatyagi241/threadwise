import { sql, type SQL } from 'drizzle-orm';
import { RequestContextStore } from '../context/request-context';

/**
 * Global and Restricted record scope for records that have a creator but no owner or team (campaigns, templates; BL-430).
 * "Global" (`all`) sees every record of the workspace, "Restricted" (`own`) only the ones the caller created. A team scope is narrower
 * than global and these records have no team, so it reads as restricted. A caller with no grant map (a worker) is not narrowed, and a
 * restricted caller that is not a staff user matches nothing (-1).
 */

/** The creator the caller is limited to under this key, or null when the caller sees every record. */
export function creatorLimit(key: string): number | null {
  const ctx = RequestContextStore.require();
  const grant = ctx.grants?.get(key);
  if (!grant || grant.effect === 'deny' || grant.scope === 'all') return null;
  return ctx.userId ?? -1;
}

/** ` AND <alias>.<column> = me` for a restricted caller, nothing for a global one. `alias` null leaves the column bare. */
export function creatorScopeSql(
  key: string,
  alias: string | null,
  column: 'created_by' | 'user_id',
): SQL {
  const me = creatorLimit(key);
  if (me === null) return sql``;
  const col = sql.raw(alias === null ? column : `${alias}.${column}`);
  return sql` AND ${col} = ${me}`;
}
