import { z } from 'zod';

/**
 * The scope registry (M-04): the small, documented set of things an app can be allowed to do, each mapped onto the workspace
 * permission keys that already exist. The admin sees `label` and `description` on the consent screen; the API enforces the keys.
 *
 * Two rules hang on this table:
 *  - Consent: the person installing may only grant a scope whose permission keys they hold themselves (installing is never a way
 *    to gain a capability).
 *  - Enforcement: an app actor can use a permission key only when one of its granted scopes lists it (`scopeCovers`).
 *
 * `leads.write` lists the contact keys: a lead is a contact in this product until the lead pipeline defines keys of its own.
 * `webhooks.manage` maps to the API-key permission, which is where webhooks and keys are managed.
 */

export const MARKET_SCOPE_RISKS = ['low', 'medium', 'high'] as const;
export type MarketScopeRisk = (typeof MARKET_SCOPE_RISKS)[number];

export interface MarketScopeDef {
  id: string;
  label: string;
  description: string;
  risk: MarketScopeRisk;
  /** Workspace permission keys (permission_defs) this scope stands for. */
  permissions: readonly string[];
}

export const MARKET_SCOPES = [
  {
    id: 'contacts.read',
    label: 'Read contacts',
    description: 'See your contacts and their details.',
    risk: 'low',
    permissions: ['record.contacts.read'],
  },
  {
    id: 'contacts.write',
    label: 'Create and edit contacts',
    description: 'Add new contacts and change existing ones.',
    risk: 'medium',
    permissions: ['record.contacts.create', 'record.contacts.update'],
  },
  {
    id: 'leads.write',
    label: 'Add leads',
    description:
      'Create leads and update them as they arrive. Leads appear as contacts in your workspace.',
    risk: 'medium',
    permissions: ['record.contacts.create', 'record.contacts.update'],
  },
  {
    id: 'conversations.read',
    label: 'Read conversations',
    description: 'See your inbox conversations and the messages in them.',
    risk: 'medium',
    permissions: ['inbox.conversation.read'],
  },
  {
    id: 'messages.send',
    label: 'Send messages',
    description: 'Send messages to your customers in your name.',
    risk: 'high',
    permissions: ['inbox.conversation.reply'],
  },
  {
    id: 'deals.read',
    label: 'Read deals',
    description: 'See your deals and pipelines.',
    risk: 'low',
    permissions: ['record.deals.read', 'record.pipelines.read'],
  },
  {
    id: 'deals.write',
    label: 'Create and edit deals',
    description: 'Add deals and move them between stages.',
    risk: 'medium',
    permissions: ['record.deals.create', 'record.deals.update'],
  },
  {
    id: 'tasks.read',
    label: 'Read tasks',
    description: 'See tasks and follow-ups.',
    risk: 'low',
    permissions: ['record.tasks.read'],
  },
  {
    id: 'tasks.write',
    label: 'Create and edit tasks',
    description: 'Add tasks and mark them done.',
    risk: 'medium',
    permissions: ['record.tasks.create', 'record.tasks.update'],
  },
  {
    id: 'appointments.read',
    label: 'Read appointments',
    description: 'See booked appointments.',
    risk: 'low',
    permissions: ['record.appointments.read'],
  },
  {
    id: 'appointments.write',
    label: 'Create and edit appointments',
    description: 'Book, move and cancel appointments.',
    risk: 'medium',
    permissions: ['record.appointments.create', 'record.appointments.update'],
  },
  {
    id: 'forms.read',
    label: 'Read forms and submissions',
    description: 'See your web forms and what visitors submitted through them.',
    risk: 'medium',
    permissions: ['record.forms.read', 'record.form-submissions.read'],
  },
  {
    id: 'forms.write',
    label: 'Create and edit forms',
    description: 'Build, publish and change web forms, and retry or review their submissions.',
    risk: 'medium',
    permissions: ['record.forms.create', 'record.forms.update', 'record.form-submissions.update'],
  },
  {
    id: 'templates.read',
    label: 'Read message templates',
    description: 'See your WhatsApp message templates.',
    risk: 'low',
    permissions: ['tpl.templates.read'],
  },
  {
    id: 'analytics.read',
    label: 'Read analytics',
    description: 'See your dashboards and reports.',
    risk: 'low',
    permissions: ['dash.analytics.read'],
  },
  {
    id: 'webhooks.manage',
    label: 'Manage webhooks and API keys',
    description: 'Create and remove webhooks and API keys for your workspace.',
    risk: 'high',
    permissions: ['admin.apikey.manage'],
  },
] as const satisfies ReadonlyArray<MarketScopeDef>;

export type MarketScopeId = (typeof MARKET_SCOPES)[number]['id'];
export const MARKET_SCOPE_IDS = MARKET_SCOPES.map((s) => s.id) as MarketScopeId[];

export const marketScopeIdSchema = z.enum(MARKET_SCOPE_IDS as [MarketScopeId, ...MarketScopeId[]]);

export const marketScopeSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  risk: z.enum(MARKET_SCOPE_RISKS),
});
export type MarketScopeSummary = z.infer<typeof marketScopeSummarySchema>;

const BY_ID = new Map<string, MarketScopeDef>(MARKET_SCOPES.map((s) => [s.id, s]));

export const isMarketScope = (id: string): id is MarketScopeId => BY_ID.has(id);

export function marketScopeSummaries(ids: readonly string[]): MarketScopeSummary[] {
  return ids.flatMap((id) => {
    const s = BY_ID.get(id);
    return s ? [{ id: s.id, label: s.label, description: s.description, risk: s.risk }] : [];
  });
}

/** Every permission key the scopes stand for, once each. Unknown scope ids stand for nothing. */
export function permissionKeysForScopes(ids: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const id of ids) for (const k of BY_ID.get(id)?.permissions ?? []) keys.add(k);
  return [...keys].sort();
}

/** True when one of the granted scopes lists the permission key: the check an app actor's request goes through. */
export function scopeCovers(granted: readonly string[], permissionKey: string): boolean {
  return granted.some((id) => BY_ID.get(id)?.permissions.includes(permissionKey));
}

/** The scopes in `requested` that `granted` does not have. */
export function newScopes(granted: readonly string[], requested: readonly string[]): string[] {
  const have = new Set(granted);
  return [...new Set(requested)].filter((s) => !have.has(s)).sort();
}

/** A version that asks for any scope the installation was not granted needs a new consent; asking for fewer never does. */
export const needsReconsent = (granted: readonly string[], requested: readonly string[]): boolean =>
  newScopes(granted, requested).length > 0;

const RISK_RANK: Record<MarketScopeRisk, number> = { low: 0, medium: 1, high: 2 };

/** The highest risk among scopes (`low` for none): what the consent screen leads with and what a low-risk fast path would test. */
export function highestScopeRisk(ids: readonly string[]): MarketScopeRisk {
  let top: MarketScopeRisk = 'low';
  for (const id of ids) {
    const r = BY_ID.get(id)?.risk;
    if (r && RISK_RANK[r] > RISK_RANK[top]) top = r;
  }
  return top;
}

/** Permission keys the person lacks among those a set of scopes stands for (empty = they may grant all of them). */
export function missingPermissionKeys(
  scopeIds: readonly string[],
  held: (key: string) => boolean,
): string[] {
  return permissionKeysForScopes(scopeIds).filter((k) => !held(k));
}
