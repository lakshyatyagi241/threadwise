import { describe, expect, it } from 'vitest';
import { API_SCOPE_RESOURCES } from '@crm/contracts';
import {
  SCOPE_PERMISSIONS,
  effectiveScopes,
  grantsForScopes,
} from '../../../src/modules/developer-rest-api-v1/auth/api-key-grants';
import { scopeAllows } from '../../../src/modules/developer-rest-api-v1/auth/api-scope';

describe('api key scopes and grants (WD-API-008)', () => {
  it('has a read and a write entry for every resource a route can name', () => {
    for (const resource of API_SCOPE_RESOURCES) {
      expect(SCOPE_PERMISSIONS, `${resource}:read`).toHaveProperty([`${resource}:read`]);
      expect(SCOPE_PERMISSIONS, `${resource}:write`).toHaveProperty([`${resource}:write`]);
    }
  });

  it('gives a key with no scopes every grant, always with the whole workspace in view', () => {
    const grants = grantsForScopes([]);
    expect(grants.get('record.contacts.read')).toEqual({ effect: 'allow', scope: 'all' });
    expect(grants.get('record.contacts.delete')).toEqual({ effect: 'allow', scope: 'all' });
    expect(grants.get('bcast.broadcasts.create')).toEqual({ effect: 'allow', scope: 'all' });
    for (const g of grants.values()) expect(g.scope).toBe('all');
  });

  it('gives a scoped key only what its scopes name', () => {
    const grants = grantsForScopes(['contacts:read']);
    expect([...grants.keys()]).toEqual(['record.contacts.read']);
    expect(grants.has('record.contacts.delete')).toBe(false);
  });

  it('lets write imply read, but not the other way round', () => {
    expect(effectiveScopes(['contacts:write'])).toEqual(['contacts:write', 'contacts:read']);
    expect(effectiveScopes(['contacts:read'])).toEqual(['contacts:read']);
    expect(grantsForScopes(['contacts:write']).has('record.contacts.read')).toBe(true);
  });

  it('ignores a scope name nobody defined', () => {
    expect([...grantsForScopes(['nonsense:read']).keys()]).toEqual([]);
  });

  it('allows a route when the key has no scopes, the scope, or the write scope for a read route', () => {
    expect(scopeAllows([], 'contacts:write')).toBe(true);
    expect(scopeAllows(['contacts:read'], 'contacts:read')).toBe(true);
    expect(scopeAllows(['contacts:write'], 'contacts:read')).toBe(true);
    expect(scopeAllows(['contacts:read'], 'contacts:write')).toBe(false);
    expect(scopeAllows(['deals:write'], 'contacts:read')).toBe(false);
  });
});
