import { describe, expect, it } from 'vitest';
import { RbacService, type GrantSet } from '../../src/kernel/rbac/rbac.service';
import {
  anyPropertyPermission,
  propertyPermissionKey,
} from '../../src/modules/crm/field-metadata-permission';

/**
 * The property under test: a contact-properties grant must not also unlock
 * company-properties, and vice versa. `can()` is pure (no database/Redis), so
 * it's exercised directly — same pattern as rbac-merge.spec.ts.
 */
const rbac = new RbacService(null as never, null as never);

function grants(entries: Array<[string, 'allow' | 'deny', 'all' | 'team' | 'own']>): GrantSet {
  return new Map(entries.map(([key, effect, scope]) => [key, { effect, scope }]));
}

describe('field-metadata moduleKey permission isolation', () => {
  it('a contact-properties grant does not unlock company-properties', () => {
    const g = grants([['record.contact-properties.read', 'allow', 'all']]);
    expect(rbac.can(g, propertyPermissionKey('contacts', 'read')).allowed).toBe(true);
    expect(rbac.can(g, propertyPermissionKey('companies', 'read')).allowed).toBe(false);
  });

  it('a company-properties grant does not unlock contact-properties', () => {
    const g = grants([['record.company-properties.update', 'allow', 'all']]);
    expect(rbac.can(g, propertyPermissionKey('companies', 'update')).allowed).toBe(true);
    expect(rbac.can(g, propertyPermissionKey('contacts', 'update')).allowed).toBe(false);
  });

  it('anyPropertyPermission covers every moduleKey for the coarse route-level gate', () => {
    expect(anyPropertyPermission('delete').sort()).toEqual(
      ['record.company-properties.delete', 'record.contact-properties.delete'].sort(),
    );
  });
});
