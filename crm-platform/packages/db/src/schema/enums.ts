import { pgEnum } from 'drizzle-orm/pg-core';

export const recordLifecycleEnum = pgEnum('record_lifecycle', [
  'draft',
  'active',
  'archived',
  'deleted',
]);

export const permEffectEnum = pgEnum('perm_effect', ['allow', 'deny']);

export const recordScopeEnum = pgEnum('record_scope', ['all', 'team', 'own', 'team_and_below']);

export const partnerAgentStatusEnum = pgEnum('partner_agent_status', ['active', 'suspended']);

export const apiKeyStatusEnum = pgEnum('api_key_status', ['active', 'revoked']);
