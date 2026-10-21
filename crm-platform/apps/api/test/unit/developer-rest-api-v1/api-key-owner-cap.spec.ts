import { describe, expect, it } from 'vitest';
import {
  capGrantsToOwner,
  grantsForScopes,
  permissionsNeededByScopes,
} from '../../../src/modules/developer-rest-api-v1/auth/api-key-grants';

// AZ-001: a key never reaches more than the member it acts as (VAPT, Sheet3 #25).
const allow = (scope: 'all' | 'own' = 'all') => ({ effect: 'allow' as const, scope });

describe('API key grants are capped to the owner', () => {
  it('keeps only the permissions the owner holds, with the owner narrower record scope', () => {
    const key = new Map([
      ['record.contacts.read', allow()],
      ['record.contacts.delete', allow()],
    ]);
    const capped = capGrantsToOwner(key, new Map([['record.contacts.read', allow('own')]]));
    expect([...capped.keys()]).toEqual(['record.contacts.read']);
    expect(capped.get('record.contacts.read')?.scope).toBe('own');
  });

  it('an unrestricted key (no scopes) of an owner with no grants has no grants', () => {
    expect(capGrantsToOwner(grantsForScopes([]), new Map()).size).toBe(0);
  });

  it('a deny on the owner side removes the permission', () => {
    const owner = new Map([['record.contacts.read', { effect: 'deny' as const, scope: 'all' as const }]]);
    expect(capGrantsToOwner(new Map([['record.contacts.read', allow()]]), owner).size).toBe(0);
  });

  it('creating an unrestricted key needs every permission any scope reaches', () => {
    expect(permissionsNeededByScopes([]).length).toBeGreaterThan(20);
  });
});
