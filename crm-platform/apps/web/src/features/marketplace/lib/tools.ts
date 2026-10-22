import {
  MARKETPLACE_TOOLS_SECTION,
  type ResolvedSettingsTile,
} from '@/features/_registry/settings-types';

/**
 * The workspace tools that used to be Settings tiles and now sit in the Marketplace. The tiles still come from the Settings registry
 * (`features/<domain>/settings.ts`), so a tool keeps its gates, its icon and its copy; this file only says where each is shown:
 *
 *  - `integrations`  built-in connectors (Shopify, Google, Email...). They are drawn in the SAME grid as the Marketplace listings of the
 *                    Integrations tab, as connector cards (`ConnectorCard`), and take part in its search, category, status filter and sort.
 *  - `developer`     developer tools (REST API, Webhooks...). Their own tab, one card each. Anything in the Settings section that is not
 *                    listed anywhere lands here, so a new tile is never lost.
 *  - `addons`        the tile of the workspace's Add-ons screen (`/addons`). The Add-ons tab now IS that list, so the tile has no card of
 *                    its own anywhere; it stays in the registry only so the screen keeps its breadcrumb and its search entry.
 */
export type ToolTab = 'integrations' | 'developer';
export type ToolPlace = ToolTab | 'addons';

/**
 * Connect an outside service: shown on the Integrations tab. Email is not here on purpose: its tile lives in Settings > Channels and the
 * Email app is a listing of the Marketplace, so it already has its card in this list.
 */
export const INTEGRATION_TOOL_IDS: readonly string[] = [
  'shopify',
  'woocommerce',
  'google-account',
  'google-sheets',
  'google-docs',
  'google-forms',
  'google-calendar',
  'video-meetings',
];

/** Extend the product: shown on the Developer tab, in this order. */
export const DEVELOPER_TOOL_IDS: readonly string[] = [
  'rest-api',
  'webhooks',
  'geta-publishing',
  'i18n-translation',
];

/** The tile of the buyable Add-ons screen: replaced by the Add-ons tab, never drawn as a card. */
export const ADDONS_SCREEN_TILE_IDS: readonly string[] = ['addons'];

export function toolTabForTile(id: string): ToolPlace {
  if (INTEGRATION_TOOL_IDS.includes(id)) return 'integrations';
  if (ADDONS_SCREEN_TILE_IDS.includes(id)) return 'addons';
  return 'developer';
}

/** The tiles of one tab: only what the person's role and plan allow (the registry already applied the gates), in the listed order. */
export function toolTilesFor(
  tab: ToolTab,
  tiles: readonly ResolvedSettingsTile[],
): ResolvedSettingsTile[] {
  const order = tab === 'integrations' ? INTEGRATION_TOOL_IDS : DEVELOPER_TOOL_IDS;
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  return tiles
    .filter((t) => t.section === MARKETPLACE_TOOLS_SECTION && toolTabForTile(t.id) === tab)
    .sort((a, b) => rank(a.id) - rank(b.id) || (a.order ?? 100) - (b.order ?? 100));
}
