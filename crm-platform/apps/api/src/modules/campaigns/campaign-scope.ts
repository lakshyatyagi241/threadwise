import { sql, type SQL } from 'drizzle-orm';
import { RequestContextStore } from '../../common/context/request-context';

/**
 * Record scope of a campaign key (BL-430): "Global" (`all`) sees every campaign of the workspace, "Restricted" (`own`) only the
 * ones its own user created. A team scope is narrower than global and campaigns have no owner or team, so it reads as restricted.
 * A caller with no grant map (a worker, an API key resolved elsewhere) is not narrowed.
 */
export type CampaignScopeKey =
  | 'camp.campaigns.read'
  | 'camp.campaigns.update'
  | 'camp.campaigns.delete'
  | 'camp.campaigns.control'
  | 'camp.campaigns.export'
  | 'camp.campaigns.test';

/** The creator the caller is limited to under this key, or null when the caller sees every campaign. */
export function campaignCreatorLimit(key: CampaignScopeKey): number | null {
  const ctx = RequestContextStore.require();
  const grant = ctx.grants?.get(key);
  if (!grant || grant.effect === 'deny' || grant.scope === 'all') return null;
  return ctx.userId ?? -1;
}

/** `AND <alias>.created_by = me` for a restricted caller, nothing for a global one. */
export function campaignScopeSql(
  key: CampaignScopeKey,
  alias: string | null = 'c',
  column: 'created_by' | 'user_id' = 'created_by',
): SQL {
  const me = campaignCreatorLimit(key);
  if (me === null) return sql``;
  const col = sql.raw(alias === null ? column : `${alias}.${column}`);
  return sql` AND ${col} = ${me}`;
}
