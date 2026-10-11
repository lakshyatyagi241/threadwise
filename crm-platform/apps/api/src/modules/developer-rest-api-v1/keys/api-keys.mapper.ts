import { API_SCOPES, type ApiKeyResponse, type ApiScope } from '@crm/contracts';
import type { ApiKeyRow } from './api-keys.repository';

const KNOWN_SCOPES: ReadonlySet<string> = new Set(API_SCOPES);

/** The one place a key row becomes what the console sees. The hash and the secret columns are never copied. */
export function toApiKeyResponse(row: ApiKeyRow): ApiKeyResponse {
  return {
    id: row.uuid,
    name: row.name,
    prefix: row.keyPrefix,
    status: row.status,
    // A name nobody defined (the column is free text) is not a scope the console can show.
    scopes: row.scopes.filter((s): s is ApiScope => KNOWN_SCOPES.has(s)),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
