import { SetMetadata } from '@nestjs/common';
import type { ApiScope } from '@crm/contracts';

export const API_SCOPE_KEY = 'api-v1:scope';

/**
 * The scope a key must hold to call this route (TW-API-008). A key with no scopes is full access, as in Reference, so this only narrows keys
 * that were given scopes. `<resource>:write` also satisfies `<resource>:read`.
 */
export const RequireApiScope = (scope: ApiScope) => SetMetadata(API_SCOPE_KEY, scope);

export function scopeAllows(held: readonly string[], required: ApiScope): boolean {
  if (held.length === 0) return true;
  if (held.includes(required)) return true;
  const [resource, action] = required.split(':') as [string, string];
  return action === 'read' && held.includes(`${resource}:write`);
}
