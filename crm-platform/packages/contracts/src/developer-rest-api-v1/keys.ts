/**
 * developer-rest-api-v1 (API): the Developers console's API-key endpoints (staff side). Identifiers are uuids and the shapes are camelCase
 * like every staff route; the customer API itself (`/api/v1`) keeps WaDesk's snake_case and lives in the sibling files.
 * See docs/wadesk-port/inventory/developer-rest-api-v1.md (WD-API-001 to 004).
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';
import { API_SCOPES, apiScopeSchema } from './envelope';

/** The console form allows 120 characters (WaDesk `DeveloperApiController@store`). */
export const API_KEY_NAME_MAX = 120;

/** What a raw key starts with; a client that pattern-matches keys relies on it (WD-API-001). */
export const API_KEY_PREFIX = 'wsk_';

export const apiKeyStatusSchema = z.enum(['active', 'revoked']);
export type ApiKeyStatusValue = z.infer<typeof apiKeyStatusSchema>;

/**
 * `scopes` is the restriction picked in the console. Omitted or empty means full access (WaDesk parity, WD-API-008): the console form
 * refuses "restrict" with nothing picked, so an empty list is never sent for a key the person meant to restrict.
 */
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(API_KEY_NAME_MAX),
  scopes: z.array(apiScopeSchema).max(API_SCOPES.length).optional(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

/** A key as the console lists it. Never carries the hash or any secret; the prefix is the first 12 characters of the raw key. */
export const apiKeyResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  prefix: z.string(),
  status: apiKeyStatusSchema,
  /** The scopes the key is restricted to. Empty is full access. */
  scopes: z.array(apiScopeSchema),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ApiKeyResponse = z.infer<typeof apiKeyResponseSchema>;

/** The one answer that carries the raw key. It is shown once and cannot be read again. */
export const createApiKeyResponseSchema = z.object({
  key: apiKeyResponseSchema,
  secret: z.string(),
});
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;

export const listApiKeysQuerySchema = paginationQuerySchema;
export type ListApiKeysQuery = z.infer<typeof listApiKeysQuerySchema>;

export const listApiKeysResponseSchema = z.object({
  data: z.array(apiKeyResponseSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
  }),
});
export type ListApiKeysResponse = z.infer<typeof listApiKeysResponseSchema>;

/** Problem codes of the console (the customer API has its own, see `envelope.ts`). */
export const API_KEY_LIMIT_MESSAGE =
  'You already have an active API key. Revoke it before creating a new one - only one key per workspace is allowed.';
