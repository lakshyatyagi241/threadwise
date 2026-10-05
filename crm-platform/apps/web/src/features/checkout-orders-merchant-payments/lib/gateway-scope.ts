import type { StoreGateway, StoreGatewayDriver } from '@crm/contracts';

/**
 * Which saved gateway row a screen is talking about. Reference keeps one list; ours has one row per (scope, gateway): the workspace row
 * (the default for the whole workspace, also read by Sales invoices) or one shop's override. The API takes the scope as an optional
 * `storefrontId`: missing means the workspace.
 */
export type GatewayScope = { kind: 'workspace' } | { kind: 'store'; storefrontId: string };

export const WORKSPACE_SCOPE: GatewayScope = { kind: 'workspace' };

/** The `storefrontId` query/body value of a scope: undefined for the workspace. */
export function scopeStorefrontId(scope: GatewayScope): string | undefined {
  return scope.kind === 'store' ? scope.storefrontId : undefined;
}

/** The other way: no id (or the legacy 0 / empty) is the workspace. */
export function scopeFromStorefrontId(id: string | null | undefined): GatewayScope {
  if (!id || id === '0') return WORKSPACE_SCOPE;
  return { kind: 'store', storefrontId: id };
}

/** Does this saved row belong to the scope? */
export function rowInScope(row: StoreGateway, scope: GatewayScope): boolean {
  if (scope.kind === 'workspace') return row.scope === 'workspace' && row.storefrontId === null;
  return row.scope === 'store' && row.storefrontId === scope.storefrontId;
}

/** The saved row of one gateway in a scope, if any. */
export function savedForScope(
  rows: readonly StoreGateway[],
  slug: string,
  scope: GatewayScope,
): StoreGateway | undefined {
  return rows.find((r) => r.slug === slug && rowInScope(r, scope));
}

/**
 * The shop a "This store only" choice starts on: the one in the address, else the overview's selected shop, else the first shop
 * of the list. A shop that is no longer in the list (and a list with nothing in it) is not offered.
 */
export function defaultOverrideShop(
  shopParam: string | undefined,
  overviewShopId: string | undefined,
  shops: readonly { id: string }[],
): string | undefined {
  const known = (id: string | undefined) => (id && shops.some((s) => s.id === id) ? id : undefined);
  // Shops are not loaded yet (or none exist): trust the address, which the sidebar validated.
  if (shops.length === 0) return shopParam ?? overviewShopId;
  return known(shopParam) ?? known(overviewShopId) ?? shops[0]?.id;
}

/** Build the scope from the two choices of the picker. `store` without a shop falls back to the workspace. */
export function chooseScope(kind: GatewayScope['kind'], shopId: string | undefined): GatewayScope {
  return kind === 'store' && shopId ? { kind: 'store', storefrontId: shopId } : WORKSPACE_SCOPE;
}

/** Rows of the saved list first, then the drivers that can be set up, then the ones that cannot yet. Stable inside each group. */
export function orderDrivers(
  drivers: readonly StoreGatewayDriver[],
  rows: readonly StoreGateway[],
  scope: GatewayScope,
): StoreGatewayDriver[] {
  const rank = (d: StoreGatewayDriver) => {
    if (savedForScope(rows, d.slug, scope)) return 0;
    return d.available ? 1 : 2;
  };
  return drivers
    .map((d, i) => ({ d, i, r: rank(d) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.d);
}

/** The catalogue search: name, description, region and currency codes, case-insensitive. An empty query keeps everything. */
export function filterDrivers(
  drivers: readonly StoreGatewayDriver[],
  query: string,
): StoreGatewayDriver[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...drivers];
  return drivers.filter((d) =>
    [d.slug, d.name, d.description, ...d.regions, ...d.currencies].some((v) =>
      v.toLowerCase().includes(q),
    ),
  );
}

/** What a card says about its saved state in a scope. */
export type CardState = 'unavailable' | 'notSetUp' | 'incomplete' | 'off' | 'active';

export function cardState(driver: StoreGatewayDriver, saved: StoreGateway | undefined): CardState {
  if (!driver.available) return 'unavailable';
  if (!saved) return 'notSetUp';
  if (!saved.configured) return 'incomplete';
  return saved.active ? 'active' : 'off';
}

/**
 * A gateway can be made the default only when it is saved, complete and switched on (the server refuses it otherwise with
 * STORE_GATEWAY_NOT_CONFIGURED); the button is hidden for a row that already is the default.
 */
export function canSetDefault(saved: StoreGateway | undefined): boolean {
  return !!saved && saved.configured && saved.active && !saved.isDefault;
}
