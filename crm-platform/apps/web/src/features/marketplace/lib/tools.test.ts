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
  'email',
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
].map((id) => tile(id));

describe('toolTilesFor', () => {
  it('puts Shopify, WooCommerce, the Google apps and Email on the Integrations tab, in that order', () => {
    expect(toolTilesFor('integrations', ALL).map((t) => t.id)).toEqual([
      'shopify',
      'woocommerce',
      'google-account',
      'google-sheets',
      'google-docs',
      'google-forms',
      'google-calendar',
      'email',
    ]);
  });

  it('puts REST API, Webhooks, Geta publishing, Translation and Add-ons on the Add-ons tab, in that order', () => {
    expect(toolTilesFor('addons', ALL).map((t) => t.id)).toEqual([
      'rest-api',
      'webhooks',
      'geta-publishing',
      'i18n-translation',
      'addons',
    ]);
  });

  it('sends a tile nobody listed to the Add-ons tab, so it is never lost', () => {
    const extra = [...ALL, tile('brand-new')];
    expect(toolTabForTile('brand-new')).toBe('addons');
    expect(toolTilesFor('addons', extra).map((t) => t.id)).toContain('brand-new');
    expect(toolTilesFor('integrations', extra).map((t) => t.id)).not.toContain('brand-new');
  });

  it('ignores tiles of other Settings sections', () => {
    expect(toolTilesFor('addons', [tile('webhooks', { section: 'security' })])).toEqual([]);
  });

  it('shows nothing for a person whose gates removed every tile', () => {
    expect(toolTilesFor('addons', [])).toEqual([]);
  });
});
