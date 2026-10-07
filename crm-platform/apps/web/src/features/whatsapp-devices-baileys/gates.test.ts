import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES_UNKNOWN, resolveNav } from '../_registry/resolve';
import type { Capabilities } from '../_registry/types';
import { nav } from './nav';

const caps = (permissions: string[], features: string[]): Capabilities => ({
  ...CAPABILITIES_UNKNOWN,
  permissions: new Set(permissions),
  planFeatures: new Set(features),
});

describe('Personal WhatsApp exists only for workspaces the operator allowed', () => {
  it('is tagged with the synthetic entitlement and the read key on its menu entry', () => {
    expect(nav[0]?.gates?.app).toBe('unofficial_whatsapp');
    expect(nav[0]?.gates?.permission).toBe('wa.devices.read');
    expect(nav[0]?.inMenu).not.toBe(false);
  });

  it('is a drawn sidebar entry and has no Settings tile', () => {
    expect(existsSync(join(__dirname, 'settings.ts'))).toBe(false);
  });

  it('is removed from the menu while the entitlement is missing', () => {
    const off = caps(['wa.devices.read'], ['automation']);
    expect(resolveNav(nav, off)).toEqual([]);
  });

  it('is removed for a member without the read key even where the engine is allowed', () => {
    const noKey = caps([], ['unofficial_whatsapp']);
    expect(resolveNav(nav, noKey)).toEqual([]);
  });

  it('is drawn once the workspace is allowed and the member may read', () => {
    const on = caps(['wa.devices.read'], ['unofficial_whatsapp']);
    expect(resolveNav(nav, on).map((n) => n.id)).toEqual(['devices']);
  });

  it('removes nothing while the entitlements are unknown (the registry rule for every gate; the API still refuses)', () => {
    const unknown = { ...caps(['wa.devices.read'], []), planFeatures: null };
    expect(resolveNav(nav, unknown).map((n) => n.id)).toEqual(['devices']);
  });
});
