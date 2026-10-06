import type { ApiKeyResponse } from '@crm/contracts';
import type { ApiKeyRow } from './api-keys.repository';

/** The one place a key row becomes what the console sees. The hash and the secret columns are never copied. */
export function toApiKeyResponse(row: ApiKeyRow): ApiKeyResponse {
  return {
    id: row.uuid,
    name: row.name,
    prefix: row.keyPrefix,
    status: row.status,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
