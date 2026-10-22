import { describe, expect, it } from 'vitest';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import { toolTabForTile, toolTilesFor } from './tools';

const tile = (id: string, over: Partial<ResolvedSettingsTile> = {}): ResolvedSettingsTile => ({
  id,
  section: 'integrations',
  labelKey: `l.${id}`,
  href: `/${id}`,
  icon: 'dot',
  locked: false,
  comingSoon: false,
  ...over,
});

const ALL = [
  'google-account',
  'woocommerce',
  'shopify',
  'addons',
  'i18n-translation',
  'geta-publishing',
  'webhooks',
  'rest-api',
  'google-calendar',
  'google-sheets',
  'google-docs',
  'google-forms',
  'video-meetings',
].map((id) => tile(id));

describe('toolTilesFor', () => {
  it('puts Shopify, WooCommerce, the Google apps and Video meetings on the Integrations tab, in that order', () => {
    expect(toolTilesFor('integrations', ALL).map((t) => t.id)).toEqual([
      'shopify',
      'woocommerce',
      'google-account',
      'google-sheets',
      'google-docs',
      'google-forms',
      'google-calendar',
      'video-meetings',
    ]);
  });

  it('puts REST API, Webhooks, Geta publishing and Translation on the Developer tab, in that order', () => {
    expect(toolTilesFor('developer', ALL).map((t) => t.id)).toEqual([
      'rest-api',
      'webhooks',
      'geta-publishing',
      'i18n-translation',
    ]);
  });

  it('draws no card for the Add-ons screen tile: the Add-ons tab is that list now', () => {
    expect(toolTabForTile('addons')).toBe('addons');
    expect(toolTilesFor('developer', ALL).map((t) => t.id)).not.toContain('addons');
    expect(toolTilesFor('integrations', ALL).map((t) => t.id)).not.toContain('addons');
  });

  it('sends a tile nobody listed to the Developer tab, so it is never lost', () => {
    const extra = [...ALL, tile('brand-new')];
    expect(toolTabForTile('brand-new')).toBe('developer');
    expect(toolTilesFor('developer', extra).map((t) => t.id)).toContain('brand-new');
    expect(toolTilesFor('integrations', extra).map((t) => t.id)).not.toContain('brand-new');
  });

  it('ignores tiles of other Settings sections', () => {
    expect(toolTilesFor('developer', [tile('webhooks', { section: 'security' })])).toEqual([]);
  });

  it('shows nothing for a person whose gates removed every tile (absent, not an empty card)', () => {
    expect(toolTilesFor('developer', [])).toEqual([]);
    expect(toolTilesFor('integrations', [])).toEqual([]);
  });

  it('keeps a plan-locked tile in the list so its card can carry the Upgrade badge', () => {
    const locked = [tile('rest-api', { locked: true })];
    expect(toolTilesFor('developer', locked).map((t) => [t.id, t.locked])).toEqual([
      ['rest-api', true],
    ]);
  });

  it('a persona that hides a connector leaves no tile, so no card either', () => {
    // The registry skips a persona-hidden tile before it gets here (resolveSettings); this checks the list follows what it is given.
    const noShopify = ALL.filter((t) => t.id !== 'shopify');
    expect(toolTilesFor('integrations', noShopify).map((t) => t.id)).not.toContain('shopify');
  });
});
