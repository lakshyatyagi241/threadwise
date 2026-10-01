import { describe, expect, it } from 'vitest';
import { landingPath } from './landing';

describe('landingPath', () => {
  const ok = { suspended: false };
  it('maps each landing to its screen', () => {
    expect(landingPath('dashboard', ok)).toBe('/dashboard');
    expect(landingPath('inbox', ok)).toBe('/inbox');
    expect(landingPath('onboarding', ok)).toBe('/onboarding');
  });
  it('a suspended account lands on the lock screen whatever the role', () => {
    expect(landingPath('dashboard', { suspended: true })).toBe('/suspended');
    expect(landingPath('onboarding', { suspended: true })).toBe('/suspended');
  });
});
