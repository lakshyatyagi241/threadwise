import type { SQL } from 'drizzle-orm';
import { creatorLimit, creatorScopeSql } from '../../common/record-scope/creator-scope';

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
  return creatorLimit(key);
}

/** `AND <alias>.created_by = me` for a restricted caller, nothing for a global one (`user_id` for the legacy broadcasts). */
export function campaignScopeSql(
  key: CampaignScopeKey,
  alias: string | null = 'c',
  column: 'created_by' | 'user_id' = 'created_by',
): SQL {
  return creatorScopeSql(key, alias, column);
}
