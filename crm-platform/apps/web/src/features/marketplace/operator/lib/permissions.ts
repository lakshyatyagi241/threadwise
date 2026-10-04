/**
 * The three platform permissions of the Marketplace catalogue (docs/api/marketplace.md, Operator API):
 * `manage` edits and operates the catalogue, `review` approves, rejects and publishes versions, `pricing` decides what an app costs
 * and handles subscriptions (money). Any one of them reads every page.
 */
export const MARKET_PERMISSIONS = {
  manage: 'platform.market.manage',
  review: 'platform.market.review',
  pricing: 'platform.market.pricing',
} as const;

export type MarketPermissionName = keyof typeof MARKET_PERMISSIONS;

export interface MarketAccess {
  /** Create and edit listings, categories, versions; submit, hide, unhide, kill, unkill, delete; triage requests. */
  manage: boolean;
  /** Approve, reject and publish versions. */
  review: boolean;
  /** Set the pricing of a listing, comp a workspace, cancel a subscription. */
  pricing: boolean;
  /** Any of the three keys reads every page. */
  canRead: boolean;
}

/** From the caller's own permission map (`GET /v2/platform/me/permissions`). A missing key counts as not held. */
export function marketAccess(
  permissions: Readonly<Record<string, boolean>> | undefined,
): MarketAccess {
  const manage = permissions?.[MARKET_PERMISSIONS.manage] === true;
  const review = permissions?.[MARKET_PERMISSIONS.review] === true;
  const pricing = permissions?.[MARKET_PERMISSIONS.pricing] === true;
  return { manage, review, pricing, canRead: manage || review || pricing };
}

/**
 * What the no-access page names when no key is held: all three, because any one of them would open the page.
 * Null when the caller may read.
 */
export function missingReadPermission(access: MarketAccess): string | null {
  return access.canRead
    ? null
    : `${MARKET_PERMISSIONS.manage}, ${MARKET_PERMISSIONS.review} or ${MARKET_PERMISSIONS.pricing}`;
}

/** The key a write needs, when the caller does not hold it; null when held. Names the key for the "why is this missing" note. */
export function missingForWrite(access: MarketAccess, need: MarketPermissionName): string | null {
  return access[need] ? null : MARKET_PERMISSIONS[need];
}
