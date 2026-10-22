import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import { SETTINGS } from '@/features/_registry/settings.generated';
import { MARKETPLACE_TOOLS_SECTION } from '@/features/_registry/settings-types';
import {
  ADDONS_SCREEN_TILE_IDS,
  DEVELOPER_TOOL_IDS,
  INTEGRATION_TOOL_IDS,
  toolTabForTile,
} from '@/features/marketplace/lib/tools';
import { SettingsTilesProvider, useSettingsPageTiles, useSettingsTiles } from './settings-context';

const tile = (id: string, section: ResolvedSettingsTile['section']): ResolvedSettingsTile => ({
  id,
  section,
  labelKey: `l.${id}`,
  href: `/${id}`,
  icon: 'dot',
  locked: false,
  comingSoon: false,
});

function Probe() {
  const page = useSettingsPageTiles().map((t) => t.id);
  const all = useSettingsTiles().map((t) => t.id);
  return <p>{`page=${page.join(',')};all=${all.join(',')}`}</p>;
}

describe('the Settings hub and the Marketplace tools', () => {
  it('lists a Marketplace tool in one place only: the Settings pages skip it, the Marketplace keeps it', () => {
    const tiles = [
      tile('rest-api', MARKETPLACE_TOOLS_SECTION),
      tile('shopify', MARKETPLACE_TOOLS_SECTION),
      tile('api-keys', 'security'),
    ];
    const html = renderToStaticMarkup(
      <SettingsTilesProvider tiles={tiles}>
        <Probe />
      </SettingsTilesProvider>,
    );
    expect(html).toContain('page=api-keys;');
    expect(html).toContain('all=rest-api,shopify,api-keys');
  });

  it('places every tile of the Marketplace section on exactly one tab, and every listed id exists in the registry', () => {
    const ids = SETTINGS.filter((t) => t.section === MARKETPLACE_TOOLS_SECTION).map((t) => t.id);
    for (const id of ids) {
      expect(['integrations', 'developer', 'addons']).toContain(toolTabForTile(id));
    }
    // a rename of a tile must not silently drop its card
    for (const id of [...INTEGRATION_TOOL_IDS, ...DEVELOPER_TOOL_IDS, ...ADDONS_SCREEN_TILE_IDS]) {
      expect(ids, id).toContain(id);
    }
  });
});
