import type { MarketAppCard } from '@crm/contracts';
import type { BrowseFilters, BrowseSort } from './browse';

/**
 * Built-in connectors (Shopify, Google, Email...) in the grid of the Integrations tab. They are not Marketplace listings: the workspace
 * tool tiles of the Settings registry carry them (gates, icon, copy). This file is the pure part that lets them live in the same list
 * as the listings: which category each belongs to, what status it has, and how they are filtered, sorted and merged into the grid.
 */

/** Where a connector sits among the listing categories of the Integrations tab (`marketplace_categories`, kind `integration`). */
export const CONNECTOR_CATEGORY: Readonly<Record<string, string>> = {
  shopify: 'e-commerce',
  woocommerce: 'e-commerce',
  'google-account': 'productivity',
  'google-sheets': 'productivity',
  'google-docs': 'productivity',
  'google-forms': 'productivity',
  'google-calendar': 'calendar-and-meetings',
  'video-meetings': 'calendar-and-meetings',
};

/** A connector no one mapped is still listed, under the catch-all category, so a new tile is never lost from the category filter. */
export const FALLBACK_CONNECTOR_CATEGORY = 'automation';

export const connectorCategory = (id: string): string =>
  CONNECTOR_CATEGORY[id] ?? FALLBACK_CONNECTOR_CATEGORY;

/**
 * What the person is told about a connector. `unknown` is "not read yet or could not be read": the card then says nothing about a
 * connection (never a guess), and the Installed filter leaves it out.
 */
export type ConnectorStatus = 'connected' | 'not_connected' | 'unknown';

/** One connector as the grid sees it: everything already translated and resolved, so the helpers below stay pure. */
export interface ConnectorEntry {
  id: string;
  name: string;
  description: string;
  categorySlug: string;
  href: string;
  icon: string;
  /** The plan does not include it: Upgrade badge, the card still opens its screen (which explains). */
  locked: boolean;
  comingSoon: boolean;
  status: ConnectorStatus;
}

/** The slices of the filters a connector understands. */
type ConnectorFilters = Pick<BrowseFilters, 'category' | 'q' | 'installed' | 'addons'>;

const norm = (s: string): string => s.trim().toLocaleLowerCase();

/**
 * The connectors that pass the filters, A-Z:
 *  - search looks in the name and the description, like the listing search;
 *  - a category keeps the connectors mapped to it;
 *  - Installed keeps the connected ones (a status that is not known is not "connected");
 *  - Available add-ons has no connector in it: a connector is not an add-on on offer.
 */
export function filterConnectors(
  entries: readonly ConnectorEntry[],
  f: ConnectorFilters,
): ConnectorEntry[] {
  if (f.addons) return [];
  const q = norm(f.q);
  return entries
    .filter((e) => {
      if (f.category && e.categorySlug !== f.category) return false;
      if (f.installed && e.status !== 'connected') return false;
      if (q && !norm(e.name).includes(q) && !norm(e.description).includes(q)) return false;
      return true;
    })
    .sort(compareByName);
}

export const compareByName = (a: { name: string }, b: { name: string }): number =>
  norm(a.name).localeCompare(norm(b.name));

/** How many connectors each category gets, to add to the listing counts of the category list. */
export function connectorCategoryCounts(
  entries: readonly ConnectorEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.categorySlug] = (counts[e.categorySlug] ?? 0) + 1;
  return counts;
}

export type GridItem =
  { type: 'card'; card: MarketAppCard } | { type: 'connector'; connector: ConnectorEntry };

/**
 * Listings and connectors in ONE list. The API pages the listings (cursor), so a connector is placed only where the loaded part of the
 * list already decides its place, and never moves afterwards:
 *  - `name`: merged A-Z with the loaded cards. A connector that sorts after the last loaded card waits until the last page is loaded
 *    (a later page could still hold a card that sorts before it).
 *  - every other sort (Most installed, Featured, Newest): the API's order has nothing to compare a connector with, so connectors
 *    follow the listings, A-Z, and appear once the last page is loaded. The Integrations catalogue is a few dozen listings at most.
 */
export function mergeGrid(
  cards: readonly MarketAppCard[],
  connectors: readonly ConnectorEntry[],
  sort: BrowseSort,
  hasNextPage: boolean,
): GridItem[] {
  const out: GridItem[] = [];
  const sortedConnectors = [...connectors].sort(compareByName);
  if (sort !== 'name') {
    for (const card of cards) out.push({ type: 'card', card });
    if (!hasNextPage)
      for (const connector of sortedConnectors) out.push({ type: 'connector', connector });
    return out;
  }
  let next = 0;
  for (const card of cards) {
    while (next < sortedConnectors.length && compareByName(sortedConnectors[next]!, card) <= 0) {
      out.push({ type: 'connector', connector: sortedConnectors[next]! });
      next += 1;
    }
    out.push({ type: 'card', card });
  }
  if (!hasNextPage) {
    for (; next < sortedConnectors.length; next += 1)
      out.push({ type: 'connector', connector: sortedConnectors[next]! });
  }
  return out;
}

// --- status from what each feature already reads -------------------------------------------------------------------------------------

/** The Google capability a Google card stands for (`GOOGLE_CAPABILITIES`); the account card needs only the connection. */
const GOOGLE_CAPABILITY_OF: Readonly<Record<string, string | null>> = {
  'google-account': null,
  'google-sheets': 'sheets',
  'google-docs': 'docs',
  'google-forms': 'forms',
  'google-calendar': 'calendar',
};

export const isGoogleConnector = (id: string): boolean => id in GOOGLE_CAPABILITY_OF;

/** Google: connected only when the account is, and (for Sheets, Docs, Forms, Calendar) the person granted that capability. */
export function googleStatus(
  id: string,
  account:
    { status: string; capabilities: ReadonlyArray<{ key: string; granted: boolean }> } | undefined,
): ConnectorStatus {
  if (!account) return 'unknown';
  if (account.status !== 'connected') return 'not_connected';
  const key = GOOGLE_CAPABILITY_OF[id];
  if (!key) return 'connected';
  return account.capabilities.some((c) => c.key === key && c.granted)
    ? 'connected'
    : 'not_connected';
}

/** Shopify and WooCommerce: a store is connected. */
export const storeStatus = (
  overview: { store: { connected: boolean } | null } | undefined,
): ConnectorStatus =>
  !overview ? 'unknown' : overview.store?.connected ? 'connected' : 'not_connected';

/** Video meetings: the person has a Zoom or Teams connection. */
export const meetingsStatus = (
  connections: { data: ReadonlyArray<{ status: string }> } | undefined,
): ConnectorStatus =>
  !connections
    ? 'unknown'
    : connections.data.some((c) => c.status === 'connected')
      ? 'connected'
      : 'not_connected';
