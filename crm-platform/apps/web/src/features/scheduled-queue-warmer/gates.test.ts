import { describe, expect, it } from 'vitest';
import { CAPABILITIES_UNKNOWN, resolveNav } from '../_registry/resolve';
import { resolveSettings } from '../_registry/settings-resolve';
import type { Capabilities } from '../_registry/types';
import { nav } from './nav';
import { settings } from './settings';

const caps = (features: string[]): Capabilities => ({
  ...CAPABILITIES_UNKNOWN,
  permissions: new Set(['sched.schedules.read', 'sched.warmer.manage']),
  planFeatures: new Set(features),
});

describe('the Warmer exists only while unofficial WhatsApp is switched on', () => {
  it('is tagged with the synthetic entitlement on its menu entry and its Settings tile', () => {
    expect(nav.find((n) => n.id === 'warmer')?.gates?.app).toBe('unofficial_whatsapp');
    expect(settings.find((t) => t.id === 'warmer')?.gates?.app).toBe('unofficial_whatsapp');
  });

  it('is removed from the menu and Settings while the entitlement is missing, but Scheduled stays', () => {
    const off = caps(['automation']);
    expect(resolveNav(nav, off).map((n) => n.id)).toEqual(['scheduled']);
    expect(resolveSettings(settings, off)).toEqual([]);
  });

  it('is back once the platform switches the engine on', () => {
    const on = caps(['automation', 'unofficial_whatsapp']);
    expect(resolveNav(nav, on).map((n) => n.id)).toEqual(['scheduled', 'warmer']);
    expect(resolveSettings(settings, on).map((t) => t.id)).toEqual(['warmer']);
  });

  it('removes nothing while the entitlements are unknown (the registry rule for every gate)', () => {
    expect(resolveNav(nav, { ...caps([]), planFeatures: null }).map((n) => n.id)).toContain(
      'warmer',
    );
  });
});
