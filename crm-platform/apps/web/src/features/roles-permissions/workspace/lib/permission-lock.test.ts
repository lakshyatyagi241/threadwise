import { describe, expect, it } from 'vitest';
import type { PermissionDefResponse } from '@crm/contracts';
import { isLocked, permissionBadge, planFeatureFallback, selectableKeys } from './permission-lock';

const def = (key: string, lock?: PermissionDefResponse['lock']): PermissionDefResponse => ({
  key,
  label: key,
  category: 'crm',
  supportsScope: false,
  ...(lock ? { lock } : {}),
});

describe('permission badge', () => {
  it('is null for a core key and for an add-on key the workspace has', () => {
    expect(permissionBadge(def('record.contacts.read'))).toBeNull();
    const hasAddon: PermissionDefResponse = { ...def('x'), planFeature: 'appointment_booking' };
    expect(permissionBadge(hasAddon)).toBeNull();
  });

  it('names the plan feature or the app that locks the key', () => {
    expect(permissionBadge(def('a', { kind: 'plan_feature', key: 'appointment_booking' }))).toEqual(
      {
        kind: 'plan_feature',
        key: 'appointment_booking',
      },
    );
    expect(permissionBadge(def('b', { kind: 'app', slug: 'google-sheets' }))).toEqual({
      kind: 'app',
      slug: 'google-sheets',
    });
  });

  it('keeps locked keys out of the selectable set', () => {
    const defs = [def('a'), def('b', { kind: 'app', slug: 's' })];
    expect(isLocked(defs[1]!)).toBe(true);
    expect(selectableKeys(defs)).toEqual(['a']);
  });

  it('falls back to the catalogue label, then the key', () => {
    expect(planFeatureFallback('appointment_booking')).toBe('Appointment booking');
    expect(planFeatureFallback('nope')).toBe('nope');
  });
});
