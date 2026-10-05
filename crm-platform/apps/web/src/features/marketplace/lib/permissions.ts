/** The three workspace permission keys of the Marketplace (docs/api/marketplace.md). Absent from the session = denied. */
export const MARKET_PERMISSIONS = {
  read: 'market.apps.read',
  install: 'market.apps.install',
  manage: 'market.apps.manage',
} as const;

export interface MarketAccess {
  /** Browse, installed list, events, ask for an integration, vote. */
  read: boolean;
  /** Install (with consent), accept new permissions, uninstall. */
  install: boolean;
  /** Configure, pause and resume, test, send a sample, rotate the secret. */
  manage: boolean;
}

export type MarketAction = keyof MarketAccess;

/** The key a person lacks for an action, to name in a "ask your admin" line; null when they hold it. */
export function missingKey(access: MarketAccess, action: MarketAction): string | null {
  return access[action] ? null : MARKET_PERMISSIONS[action];
}
