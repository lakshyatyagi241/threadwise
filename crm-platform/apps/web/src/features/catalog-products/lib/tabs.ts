export const CATALOG_TABS = [
  { id: 'setup', href: '/catalog' },
  { id: 'send', href: '/catalog/send' },
  { id: 'collections', href: '/catalog/collections' },
  { id: 'activity', href: '/catalog/activity' },
] as const;
export type CatalogTab = (typeof CATALOG_TABS)[number]['id'];

/** `/catalog/send/` and `/catalog/send` are the same tab; `/catalog` is Setup. */
export function activeTab(pathname: string): CatalogTab {
  const clean = pathname.replace(/\/+$/, '');
  return CATALOG_TABS.find((t) => t.href === clean)?.id ?? 'setup';
}
