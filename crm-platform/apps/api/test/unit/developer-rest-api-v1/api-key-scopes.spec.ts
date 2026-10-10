import { describe, expect, it } from 'vitest';
import {
  API_SCOPES,
  API_SCOPE_RESOURCES,
  apiKeyResponseSchema,
  createApiKeySchema,
} from '@crm/contracts';
import { SCOPE_PERMISSIONS } from '../../../src/modules/developer-rest-api-v1/auth/api-key-grants';
import { toApiKeyResponse } from '../../../src/modules/developer-rest-api-v1/keys/api-keys.mapper';
import type { ApiKeyRow } from '../../../src/modules/developer-rest-api-v1/keys/api-keys.repository';

/** The scopes a key is created with from the Developers console (AUTH-073): the contract, and how a stored row reads back. */
describe('api key scopes: create contract', () => {
  it('lists every scope the guard knows, read before write, and no other', () => {
    expect(API_SCOPES).toHaveLength(API_SCOPE_RESOURCES.length * 2);
    expect([...API_SCOPES].sort()).toEqual(Object.keys(SCOPE_PERMISSIONS).sort());
    expect(API_SCOPES.slice(0, 2)).toEqual(['account:read', 'account:write']);
  });

  it('accepts a name alone: no scopes is full access, as in WaDesk', () => {
    expect(createApiKeySchema.parse({ name: 'Prod' })).toEqual({ name: 'Prod' });
    expect(createApiKeySchema.parse({ name: 'Prod', scopes: [] }).scopes).toEqual([]);
  });

  it('accepts known scopes', () => {
    const parsed = createApiKeySchema.parse({
      name: 'Prod',
      scopes: ['contacts:read', 'messages:write'],
    });
    expect(parsed.scopes).toEqual(['contacts:read', 'messages:write']);
    expect(createApiKeySchema.safeParse({ name: 'All', scopes: [...API_SCOPES] }).success).toBe(
      true,
    );
  });

  it('refuses a scope nobody defined, a wrong shape and a list longer than the catalogue', () => {
    for (const scopes of [
      ['nonsense:read'],
      ['contacts:delete'],
      ['contacts'],
      ['CONTACTS:READ'],
      'contacts:read',
      [1],
      [...API_SCOPES, 'contacts:read'],
    ]) {
      expect(
        createApiKeySchema.safeParse({ name: 'x', scopes }).success,
        JSON.stringify(scopes),
      ).toBe(false);
    }
  });
});

describe('api key scopes: response', () => {
  const row = (scopes: string[]): ApiKeyRow =>
    ({
      id: 1,
      uuid: '0b9c1d5e-5f4e-4a39-9a2e-8f8a3b6c1d20',
      name: 'Prod',
      keyPrefix: 'wsk_Xk3pQ9aB',
      status: 'active',
      scopes,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date('2026-10-01T09:00:00.000Z'),
    }) as unknown as ApiKeyRow;

  it('shows the stored scopes, and an empty list for a full-access key', () => {
    expect(toApiKeyResponse(row(['contacts:read', 'deals:write'])).scopes).toEqual([
      'contacts:read',
      'deals:write',
    ]);
    const full = toApiKeyResponse(row([]));
    expect(full.scopes).toEqual([]);
    expect(apiKeyResponseSchema.safeParse(full).success).toBe(true);
  });

  it('drops a stored name the console cannot show, so the answer still satisfies the contract', () => {
    const res = toApiKeyResponse(row(['contacts:read', 'legacy:thing']));
    expect(res.scopes).toEqual(['contacts:read']);
    expect(apiKeyResponseSchema.safeParse(res).success).toBe(true);
  });

  it('never copies the hash or the secret columns', () => {
    const res = toApiKeyResponse({
      ...row([]),
      keyHash: 'sha256$abc',
      signingSecretEnc: 'x',
    } as ApiKeyRow);
    expect(JSON.stringify(res)).not.toContain('sha256');
    expect(Object.keys(res)).not.toContain('keyHash');
  });
});
