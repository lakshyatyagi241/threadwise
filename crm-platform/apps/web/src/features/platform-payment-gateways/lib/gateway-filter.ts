import { PAYGW_REGIONS, type PaygwGatewayItem, type PaygwRegion } from '@crm/contracts';

export type RegionTab = 'all' | PaygwRegion;
export const REGION_TABS: readonly RegionTab[] = ['all', ...PAYGW_REGIONS];

/** A gateway matches the search by name or slug, case-insensitively; blank matches everything. */
export function matchesSearch(g: Pick<PaygwGatewayItem, 'name' | 'slug'>, search: string): boolean {
  const q = search.trim().toLowerCase();
  return q === '' || g.name.toLowerCase().includes(q) || g.slug.toLowerCase().includes(q);
}

export function filterGateways(
  items: readonly PaygwGatewayItem[],
  tab: RegionTab,
  search: string,
): PaygwGatewayItem[] {
  return items.filter(
    (g) => (tab === 'all' || g.regions.includes(tab)) && matchesSearch(g, search),
  );
}

/** Live counts for the tab labels (counted before the search, as tabs are a category, not a result). */
export function tabCounts(items: readonly PaygwGatewayItem[]): Record<RegionTab, number> {
  const out = Object.fromEntries(REGION_TABS.map((t) => [t, 0])) as Record<RegionTab, number>;
  out.all = items.length;
  for (const g of items) for (const r of new Set(g.regions)) out[r] += 1;
  return out;
}

/** Every currency code any gateway lists, for the whitelist pill grid. */
export function currencyChoices(items: readonly PaygwGatewayItem[]): string[] {
  return [...new Set(items.flatMap((g) => g.supportedCurrencies))].sort();
}
