import { describe, expect, it } from 'vitest';
import { APP_HOME, appHomeFor } from './app-home';

describe('appHomeFor', () => {
  it('opens the screen of an app that is running', () => {
    expect(appHomeFor('lead-scoring', 'active')).toBe('/lead-scoring');
    expect(appHomeFor('forms', 'active')).toBe('/forms');
    expect(appHomeFor('whatsapp-devices', 'active')).toBe('/devices');
  });

  it('opens nothing for an app that is paused or stopped by the platform', () => {
    expect(appHomeFor('lead-scoring', 'disabled')).toBeNull();
    expect(appHomeFor('lead-scoring', 'killed')).toBeNull();
  });

  it('has no screen for an app that lives elsewhere (a lead portal, the Chrome extension)', () => {
    expect(appHomeFor('indiamart', 'active')).toBeNull();
    expect(appHomeFor('chrome-extension', 'active')).toBeNull();
    expect(appHomeFor('nothing-like-this', 'active')).toBeNull();
  });

  it('keeps every address an in-app path', () => {
    for (const [slug, href] of Object.entries(APP_HOME)) {
      expect(href, slug).toMatch(/^\/[a-z0-9/-]+$/);
    }
  });
});
