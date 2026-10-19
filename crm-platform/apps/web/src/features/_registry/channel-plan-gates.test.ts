import { describe, expect, it } from 'vitest';
import { NAV } from './nav.generated';
import { SETTINGS } from './settings.generated';

const EXTRA = ['telegram', 'facebook', 'instagram', 'line', 'viber', 'wechat'];

describe('channel plan gates', () => {
  it('locks the Settings tile of every extra channel with the plan feature the API checks', () => {
    for (const id of EXTRA) {
      const tile = SETTINGS.find((t) => t.id === id);
      expect(tile?.gates?.planFeature, id).toBe('extra_channels');
    }
  });

  it('closes the root screen of every extra channel while the plan lacks the feature', () => {
    for (const id of EXTRA) {
      const entry = NAV.find((n) => n.href === `/${id}`);
      expect(entry, id).toBeDefined();
      expect(entry?.gates?.planFeature, id).toBe('extra_channels');
      expect(entry?.gates?.closeWhenLocked, id).toBe(true);
      // Not drawn in the sidebar: the Settings tile is its entry.
      expect(entry?.inMenu, id).toBe(false);
    }
  });

  it('puts Webhooks and API keys in Settings as well as in the Marketplace', () => {
    const keys = SETTINGS.find((t) => t.id === 'api-keys');
    const hooks = SETTINGS.find((t) => t.id === 'webhooks-endpoints');
    expect(keys).toMatchObject({ section: 'security', href: '/developers' });
    expect(hooks).toMatchObject({ section: 'security', href: '/webhooks' });
    // The Marketplace cards stay.
    expect(SETTINGS.find((t) => t.id === 'rest-api')?.section).toBe('integrations');
    expect(SETTINGS.find((t) => t.id === 'webhooks')?.section).toBe('integrations');
  });
});
