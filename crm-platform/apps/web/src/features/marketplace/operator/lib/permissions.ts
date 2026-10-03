/**
 * The two platform permissions of the Marketplace catalogue (docs/api/marketplace.md, Operator API):
 * `manage` edits and operates the catalogue, `review` approves, rejects and publishes versions. Either one reads every page.
 */
export const MARKET_PERMISSIONS = {
  manage: 'platform.market.manage',
  review: 'platform.market.review',
} as const;

export type MarketPermissionName = keyof typeof MARKET_PERMISSIONS;

export interface MarketAccess {
  /** Create and edit listings, categories, versions; submit, hide, unhide, kill, unkill, delete; triage requests. */
  manage: boolean;
  /** Approve, reject and publish versions. */
  review: boolean;
  /** Either key reads every page. */
  canRead: boolean;
}

/** From the caller's own permission map (`GET /v2/platform/me/permissions`). A missing key counts as not held. */
export function marketAccess(
  permissions: Readonly<Record<string, boolean>> | undefined,
): MarketAccess {
  const manage = permissions?.[MARKET_PERMISSIONS.manage] === true;
  const review = permissions?.[MARKET_PERMISSIONS.review] === true;
  return { manage, review, canRead: manage || review };
}

/**
 * What the no-access page names when neither key is held: both, because either one would open the page.
 * Null when the caller may read.
 */
export function missingReadPermission(access: MarketAccess): string | null {
  return access.canRead ? null : `${MARKET_PERMISSIONS.manage} or ${MARKET_PERMISSIONS.review}`;
}

/** The key a write needs, when the caller does not hold it; null when held. Names the key for the "why is this missing" note. */
export function missingForWrite(access: MarketAccess, need: MarketPermissionName): string | null {
  return access[need] ? null : MARKET_PERMISSIONS[need];
}
