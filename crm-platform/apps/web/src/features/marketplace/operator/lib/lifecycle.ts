import type {
  MarketAppStatus,
  MarketOperatorApp,
  MarketOperatorVersion,
  MarketVersionStatus,
} from '@crm/contracts';
import type { MarketAccess, MarketPermissionName } from './permissions';

/**
 * The listing lifecycle as one table, the same rules the API enforces (docs/api/marketplace.md, "Listing lifecycle";
 * `apps/api/src/modules/marketplace/marketplace-rules.ts` for versions). The server stays the authority: a refused action still comes
 * back as MKT_VERSION_STATE, and the screen shows it. This table only decides what the screen offers.
 *
 *   App:     draft -> in_review -> published <-> hidden, and killed from any state (killed -> hidden by unkill).
 *   Version: draft -> in_review -> approved -> published -> retired, or rejected (edited, then submitted again).
 */

// --- versions --------------------------------------------------------------------------------------------------------------------------

export const VERSION_ACTIONS = ['edit', 'submit', 'approve', 'reject', 'publish'] as const;
export type VersionAction = (typeof VERSION_ACTIONS)[number];

/** States each version action is allowed from. Approve and reject also work on a draft: the API lets one operator do both. */
export const VERSION_ALLOWED: Record<VersionAction, readonly MarketVersionStatus[]> = {
  edit: ['draft', 'rejected'],
  submit: ['draft', 'rejected'],
  approve: ['draft', 'in_review'],
  reject: ['draft', 'in_review'],
  publish: ['approved'],
};

/** The permission each version action needs: operating is `manage`, deciding and publishing is `review`. */
export const VERSION_ACTION_NEEDS: Record<VersionAction, MarketPermissionName> = {
  edit: 'manage',
  submit: 'manage',
  approve: 'review',
  reject: 'review',
  publish: 'review',
};

export const versionActionAllowed = (status: MarketVersionStatus, action: VersionAction): boolean =>
  VERSION_ALLOWED[action].includes(status);

type AppFacts = Pick<MarketOperatorApp, 'status'>;

/**
 * The version actions to offer: state allows it and the caller holds the key. An action the caller's key does not cover is left out
 * (the page says which key it needs); publishing is also left out of a killed listing, which the API refuses.
 */
export function versionActions(
  version: Pick<MarketOperatorVersion, 'status'>,
  app: AppFacts,
  access: MarketAccess,
): VersionAction[] {
  return VERSION_ACTIONS.filter((action) => {
    if (!versionActionAllowed(version.status, action)) return false;
    if (!access[VERSION_ACTION_NEEDS[action]]) return false;
    if (action === 'publish' && app.status === 'killed') return false;
    return true;
  });
}

/** The version actions state allows, whoever holds the key: what the page says is blocked for lack of a key. */
export function versionActionsByState(
  version: Pick<MarketOperatorVersion, 'status'>,
  app: AppFacts,
): VersionAction[] {
  return VERSION_ACTIONS.filter(
    (a) => versionActionAllowed(version.status, a) && !(a === 'publish' && app.status === 'killed'),
  );
}

// --- the listing -----------------------------------------------------------------------------------------------------------------------

export const APP_ACTIONS = [
  'editListing',
  'newVersion',
  'hide',
  'unhide',
  'kill',
  'unkill',
  'delete',
] as const;
export type AppAction = (typeof APP_ACTIONS)[number];

/** Every app action is an operating action: it needs `platform.market.manage`. */
export const APP_ACTION_NEEDS: Record<AppAction, MarketPermissionName> = {
  editListing: 'manage',
  newVersion: 'manage',
  hide: 'manage',
  unhide: 'manage',
  kill: 'manage',
  unkill: 'manage',
  delete: 'manage',
};

type AppStateFacts = Pick<
  MarketOperatorApp,
  'status' | 'publishedVersion' | 'publishedAt' | 'installCount'
>;

/** Whether the listing's state allows the action (the key is a separate question). */
export function appActionAllowed(app: AppStateFacts, action: AppAction): boolean {
  const status: MarketAppStatus = app.status;
  switch (action) {
    case 'editListing':
    case 'newVersion':
      return true;
    case 'hide':
      return status === 'published';
    case 'unhide':
      // A hidden listing with a version to show again; one that was never published has nothing to show.
      return status === 'hidden' && app.publishedVersion !== null;
    case 'kill':
      return status !== 'killed';
    case 'unkill':
      return status === 'killed';
    case 'delete':
      // Only a listing that was never published and was never installed; anything else is hidden or killed instead.
      return (
        (status === 'draft' || status === 'in_review') &&
        app.installCount === 0 &&
        app.publishedVersion === null &&
        app.publishedAt === null
      );
  }
}

export function appActions(app: AppStateFacts, access: MarketAccess): AppAction[] {
  return APP_ACTIONS.filter((a) => appActionAllowed(app, a) && access[APP_ACTION_NEEDS[a]]);
}

/** The permission keys the page names as missing: an action state allows but the caller's keys do not cover. */
export function lackedPermissions(
  app: AppStateFacts,
  version: Pick<MarketOperatorVersion, 'status'> | null,
  access: MarketAccess,
): MarketPermissionName[] {
  const lacking = new Set<MarketPermissionName>();
  for (const a of APP_ACTIONS) {
    if (appActionAllowed(app, a) && !access[APP_ACTION_NEEDS[a]]) lacking.add(APP_ACTION_NEEDS[a]);
  }
  if (version) {
    for (const a of versionActionsByState(version, app)) {
      if (!access[VERSION_ACTION_NEEDS[a]]) lacking.add(VERSION_ACTION_NEEDS[a]);
    }
  }
  return [...lacking].sort();
}
