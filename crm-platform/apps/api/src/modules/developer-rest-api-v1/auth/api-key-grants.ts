import type { ApiScope } from '@crm/contracts';
import type { Grant, GrantSet } from '../../../kernel/rbac/rbac.service';

/**
 * Why a key carries grants at all: the services behind each resource are the ones the dashboard uses, and several read the caller's grants
 * (`ctx.grants`) to decide how far they may see. A key is not a staff member and holds no role, so the guard builds a grant set from the
 * key's scopes: exactly the capabilities of the routes it may call, always with `all` record scope (Reference: a key sees the whole workspace).
 *
 * A key with no scopes is full access (TW-API-008) and gets the union.
 */
export const SCOPE_PERMISSIONS: Record<ApiScope, readonly string[]> = {
  'account:read': [],
  'account:write': [],
  'contacts:read': ['record.contacts.read'],
  'contacts:write': ['record.contacts.create', 'record.contacts.update', 'record.contacts.delete'],
  'contact-groups:read': ['record.contact-groups.read', 'record.tags.read', 'record.contacts.read'],
  'contact-groups:write': [
    'record.contact-groups.create',
    'record.contact-groups.update',
    'record.contact-groups.delete',
    'record.tags.create',
    'record.tags.update',
    'record.contacts.update',
  ],
  'deals:read': ['record.deals.read', 'record.pipelines.read'],
  'deals:write': ['record.deals.create', 'record.deals.update', 'record.deals.delete'],
  'flows:read': ['flr.runs.read'],
  'flows:write': ['flr.runs.manage'],
  'templates:read': ['tpl.templates.read'],
  'templates:write': ['tpl.templates.create', 'tpl.templates.delete', 'tpl.templates.sync'],
  'auto-replies:read': [],
  'auto-replies:write': [],
  'broadcasts:read': ['bcast.broadcasts.read'],
  'broadcasts:write': [
    'bcast.broadcasts.create',
    'bcast.broadcasts.delete',
    'bcast.broadcasts.retry',
    'bcast.broadcasts.resume',
    'bcast.broadcasts.export',
  ],
  'campaigns:read': ['camp.campaigns.read'],
  'campaigns:write': [
    'camp.campaigns.create',
    'camp.campaigns.update',
    'camp.campaigns.delete',
    'camp.campaigns.control',
    'camp.campaigns.export',
  ],
  'scheduled:read': ['sched.schedules.read'],
  'scheduled:write': ['sched.schedules.manage'],
  'messages:read': ['inbox.conversation.read'],
  'messages:write': ['inbox.conversation.reply'],
  'media:read': [],
  'media:write': [],
  'conversations:read': ['inbox.conversation.read'],
  'conversations:write': ['inbox.conversation.reply'],
  'devices:read': ['waba.numbers.read'],
  'devices:write': [],
  'webhooks:read': [],
  'webhooks:write': [],
};

const ALL_SCOPES = Object.keys(SCOPE_PERMISSIONS) as ApiScope[];

/** Scope list of a key, expanded: `<r>:write` brings `<r>:read` with it. Empty means every scope. */
export function effectiveScopes(held: readonly string[]): ApiScope[] {
  if (held.length === 0) return ALL_SCOPES;
  const out = new Set<ApiScope>();
  for (const scope of held) {
    if (!(scope in SCOPE_PERMISSIONS)) continue;
    out.add(scope as ApiScope);
    if (scope.endsWith(':write')) out.add(scope.replace(':write', ':read') as ApiScope);
  }
  return [...out];
}

export function grantsForScopes(held: readonly string[]): GrantSet {
  const allow: Grant = { effect: 'allow', scope: 'all' };
  const grants: GrantSet = new Map();
  for (const scope of effectiveScopes(held)) {
    for (const key of SCOPE_PERMISSIONS[scope]) grants.set(key, allow);
  }
  return grants;
}
