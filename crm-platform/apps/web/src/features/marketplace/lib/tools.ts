import {
  MARKETPLACE_TOOLS_SECTION,
  type ResolvedSettingsTile,
} from '@/features/_registry/settings-types';

/**
 * The workspace tools that used to be Settings tiles (Integrations and developer) and now sit in the Marketplace as cards: which
 * tab each one is on. The tiles still come from the Settings registry (`features/<domain>/settings.ts`), so a tool keeps its gates,
 * its icon and its copy; this file only says where it is shown. Anything in that section not listed here lands on the Add-ons tab,
 * so a new tile is never lost.
 */
export type ToolTab = 'addons' | 'integrations';

/** Connect an outside service: shown on the Integrations tab, in this order. */
export const INTEGRATION_TOOL_IDS: readonly string[] = [
  'shopify',
  'woocommerce',
  'google-account',
  'email',
];

/** Extend the product: shown on the Add-ons tab, in this order. */
export const ADDON_TOOL_IDS: readonly string[] = [
  'google-calendar',
  'rest-api',
  'webhooks',
  'geta-publishing',
  'i18n-translation',
  'addons',
];

export function toolTabForTile(id: string): ToolTab {
  return INTEGRATION_TOOL_IDS.includes(id) ? 'integrations' : 'addons';
}

/** The tiles of one tab: only what the person's role and plan allow (the registry already applied the gates), in the listed order. */
export function toolTilesFor(
  tab: ToolTab,
  tiles: readonly ResolvedSettingsTile[],
): ResolvedSettingsTile[] {
  const order = tab === 'integrations' ? INTEGRATION_TOOL_IDS : ADDON_TOOL_IDS;
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  return tiles
    .filter((t) => t.section === MARKETPLACE_TOOLS_SECTION && toolTabForTile(t.id) === tab)
    .sort((a, b) => rank(a.id) - rank(b.id) || (a.order ?? 100) - (b.order ?? 100));
}
