import { describe, expect, it } from 'vitest';
import { SECURITY_TABS } from './policy-draft';
import { REGISTRATION_SETTINGS_HREF, WORKSPACES_HREF, securityTabHref } from './links';
import { asTab } from './tab-state';

describe('securityTabHref', () => {
  it('opens the Security Center on the named tab, through the hash the tab hook reads', () => {
    for (const tab of SECURITY_TABS) {
      expect(securityTabHref(tab)).toBe(`/admin/security#${tab}`);
      expect(asTab(securityTabHref(tab).split('#')[1])).toBe(tab);
    }
  });
});

describe('console addresses', () => {
  it('points at the operator workspaces list and the registration policy', () => {
    expect(WORKSPACES_HREF).toBe('/admin/workspaces');
    expect(REGISTRATION_SETTINGS_HREF).toBe('/admin/settings/registration');
  });
});
