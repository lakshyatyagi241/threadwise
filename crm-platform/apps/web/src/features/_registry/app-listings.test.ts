import { PLAN_FEATURE_DEFS } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { APP_HOME } from '../marketplace/lib/app-home';
import { APP_LISTING_BY_FEATURE, listingPathFor } from './app-listings';

describe('APP_LISTING_BY_FEATURE', () => {
  it('names only real plan features, each off by default (an app cannot own a feature every plan grants)', () => {
    for (const feature of Object.keys(APP_LISTING_BY_FEATURE)) {
      const def = PLAN_FEATURE_DEFS.find((d) => d.key === feature);
      expect(def, feature).toBeDefined();
      expect(def!.default, feature).toBe(false);
    }
  });

  it('gives each listing one feature, and every listing a screen to open', () => {
    const slugs = Object.values(APP_LISTING_BY_FEATURE);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(APP_HOME[slug], slug).toMatch(/^\//);
  });

  it('links an app-owned feature to the app page, and nothing else', () => {
    expect(listingPathFor('lead_scoring')).toBe('/marketplace/app/lead-scoring');
    expect(listingPathFor('appointment_booking')).toBe('/marketplace/app/appointments');
    expect(listingPathFor('analytics')).toBeNull();
    expect(listingPathFor('unofficial_whatsapp')).toBeNull();
  });
});
