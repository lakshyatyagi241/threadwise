import { SetMetadata } from '@nestjs/common';
import type { ApiScope } from '@crm/contracts';

export const API_SCOPE_KEY = 'api-v1:scope';

/**
 * The scope a key must hold to call this route. `<resource>:write` also satisfies `<resource>:read`. A key holds at least one scope, so a
 * key with none holds nothing and every route refuses it.
 */
export const RequireApiScope = (scope: ApiScope) => SetMetadata(API_SCOPE_KEY, scope);

export function scopeAllows(held: readonly string[], required: ApiScope): boolean {
  if (held.includes(required)) return true;
  const [resource, action] = required.split(':') as [string, string];
  return action === 'read' && held.includes(`${resource}:write`);
}
