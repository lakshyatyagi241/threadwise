import { describe, expect, it } from 'vitest';
import { RbacService, type GrantSet } from '../../src/kernel/rbac/rbac.service';

/**
 * The merge rules are pure logic, so they are tested directly — no database,
 * no Redis. `can()` does not touch either.
 */
const rbac = new RbacService(null as never, null as never);

function grants(entries: Array<[string, 'allow' | 'deny', 'all' | 'team' | 'own']>): GrantSet {
  return new Map(entries.map(([key, effect, scope]) => [key, { effect, scope }]));
}

describe('RbacService.can', () => {
  it('denies a permission that was never granted', () => {
    expect(rbac.can(grants([]), 'record.contacts.read').allowed).toBe(false);
  });

  it('allows a granted permission and reports its scope', () => {
    const result = rbac.can(
      grants([['record.contacts.read', 'allow', 'team']]),
      'record.contacts.read',
    );
    expect(result).toEqual({ allowed: true, scope: 'team' });
  });

  it('treats an explicit deny as a denial', () => {
    const result = rbac.can(
      grants([['record.contacts.read', 'deny', 'all']]),
      'record.contacts.read',
    );
    expect(result.allowed).toBe(false);
  });

  it('falls back to the narrowest scope when denying', () => {
    // A denied caller must never come back with scope 'all' — if a caller
    // ignored `allowed` and used the scope, the safe value is the narrow one.
    expect(rbac.can(grants([]), 'anything').scope).toBe('own');
  });
});
