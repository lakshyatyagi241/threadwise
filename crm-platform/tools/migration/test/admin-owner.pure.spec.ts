import { describe, expect, it } from 'vitest';
import { isWabooAdminRole } from '../transform/users';

describe('Waboo admins become Owners (owner decision, 2026-10-21)', () => {
  it('a role named admin, in any case or with spaces, is the admin role', () => {
    expect(isWabooAdminRole('admin')).toBe(true);
    expect(isWabooAdminRole(' Admin ')).toBe(true);
    expect(isWabooAdminRole('ADMIN')).toBe(true);
  });

  it('other roles, empty names and missing names are not', () => {
    expect(isWabooAdminRole('support_agent')).toBe(false);
    expect(isWabooAdminRole('tele_fundraisers')).toBe(false);
    expect(isWabooAdminRole('admin team')).toBe(false);
    expect(isWabooAdminRole('')).toBe(false);
    expect(isWabooAdminRole(null)).toBe(false);
    expect(isWabooAdminRole(undefined)).toBe(false);
  });
});
