import { GENERIC_PERSONA_DEFINITION, personaDefinitionSchema, type PersonaDefinition } from './definition';

/**
 * Edition presets (docs/specs/teams-unification.md 5.6 and phase T3, BL-383): three catalog personas that make ONE product look like a
 * chat product, a sales CRM, or both. They are DATA seeded through the persona tables (migration `20270220090100_edition_personas.sql`,
 * which a test compares to this file); nothing in the code branches on them or on a plan name.
 *
 * They only decide what is DRAWN (spec 6.2): the plan, add-ons and permissions still decide what is allowed, entitlement wins, and a hidden
 * module is never locked and never loses its API or its typed address. Contacts are the shared core of every edition: the contact list and
 * the contact page are never hidden, only the sections of the other side are.
 *
 * Chat side = inbox, channels, team chat, calling, broadcasts and their tools. CRM side = deals, companies, tasks, invoicing, proposals,
 * assignment, lead handling and the sales dashboard. Role presets per edition (Viewer and Agent for chat, owner and visibility wording for
 * sales) are the follow-up of T1 and T2 and are not part of these definitions.
 */

/** Hidden in a chat-only edition: the sales side. */
export const CRM_SIDE_MODULES = [
  'nav:deals',
  'nav:companies',
  'nav:tasks',
  'nav:crm-dashboard',
  'nav:invoices',
  'nav:payments',
  'nav:sales-orders',
  'nav:credit-notes',
  'nav:recurring-invoices',
  'nav:proposals',
  'nav:estimates',
  'nav:appointments',
  'nav:forms',
  'nav:lead-scoring',
  'nav:growth',
  'tile:deal-pipelines',
  'tile:record-assignment',
  'tile:lead-sources',
  'tile:lead-scoring',
  'tile:sales-activities',
  'tile:tax-rates',
  'tile:uncontacted-leads',
  'tile:follow-ups',
  'tile:duplicate-leads',
  'tile:company-properties',
  'tile:booking-types',
  'tile:appointment-settings',
  'tile:booking-page-appearance',
  'section:contact.tasks',
  'section:contact.deals',
  'section:contact.appointments',
  'section:contact.sales',
  'section:contact.lead-source',
  'section:contact.company',
  'section:contact.meetings',
  'action:contact.task',
  'action:contact.meeting',
  'action:contact.company',
  'action:contact.score',
  'card:dashboard.pipeline',
  'card:dashboard.funnel',
] as const;

/** Hidden in a CRM-only edition: the conversation side. Inbox entries, inbox wording and the chat channels disappear. */
export const CHAT_SIDE_MODULES = [
  'nav:inbox',
  'nav:inbox-message-logs',
  'nav:inbox-saved-replies',
  'nav:quick-chat',
  'nav:team-chat',
  'nav:call-logs',
  'nav:campaigns',
  'nav:scheduled',
  'nav:warmer',
  'nav:history',
  'nav:templates',
  'nav:wa-forms',
  'nav:wa-links',
  'nav:waba-groups',
  'nav:devices',
  'nav:devices-groups',
  'nav:facebook',
  'nav:facebook-posts',
  'nav:facebook-broadcasts',
  'nav:facebook-setup',
  'nav:instagram',
  'nav:instagram-broadcast',
  'nav:line',
  'nav:telegram',
  'nav:viber',
  'nav:wechat',
  'tile:saved-replies',
  'tile:inbox-tags',
  'tile:message-logs',
  'tile:auto-assignment',
  'tile:sla-policies',
  'tile:team-performance',
  'tile:auto-reply',
  'tile:chat-widget',
  'tile:calling',
  'tile:facebook',
  'tile:instagram',
  'tile:line',
  'tile:telegram',
  'tile:viber',
  'tile:wechat',
  'tile:tiktok',
  'tile:unofficial-whatsapp',
  'section:contact.conversations',
  'action:contact.call',
  'card:dashboard.inbox',
  'card:dashboard.sent',
  'card:dashboard.read',
  'card:dashboard.instagram',
  'card:dashboard.devices',
  'card:dashboard.templates',
  'card:dashboard.campaigns',
] as const;

const NO_PRESETS = GENERIC_PERSONA_DEFINITION.presets;

const hide = (ids: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, 'hide' as const]));

export const CHAT_TEAM_PERSONA_DEFINITION: PersonaDefinition = {
  schemaVersion: 1,
  label: { en: 'Chat team' },
  summary: { en: 'Conversations, channels and contacts. The sales side stays out of the way.' },
  icon: 'message-circle',
  teamSizes: [],
  vocabulary: { nouns: {}, phrases: {} },
  modules: { default: 'show', ids: hide(CRM_SIDE_MODULES) },
  presets: NO_PRESETS,
  checklist: [],
};

export const SALES_TEAM_PERSONA_DEFINITION: PersonaDefinition = {
  schemaVersion: 1,
  label: { en: 'Sales team' },
  summary: { en: 'Contacts, companies, deals and tasks. The inbox and chat channels stay out of the way.' },
  icon: 'briefcase',
  teamSizes: [],
  vocabulary: { nouns: {}, phrases: {} },
  modules: { default: 'show', ids: hide(CHAT_SIDE_MODULES) },
  presets: NO_PRESETS,
  checklist: [],
};

export const BOTH_PERSONA_DEFINITION: PersonaDefinition = {
  schemaVersion: 1,
  label: { en: 'Chat and sales' },
  summary: { en: 'The whole product: conversations and the sales CRM together.' },
  icon: 'layers',
  teamSizes: [],
  vocabulary: { nouns: {}, phrases: {} },
  modules: { default: 'show', ids: {} },
  presets: NO_PRESETS,
  checklist: [],
};

/** Persona key to its version 1 definition; the migration seeds exactly these. */
export const EDITION_PERSONAS: Readonly<Record<string, PersonaDefinition>> = {
  chat_team: CHAT_TEAM_PERSONA_DEFINITION,
  sales_team: SALES_TEAM_PERSONA_DEFINITION,
  both: BOTH_PERSONA_DEFINITION,
};

for (const def of Object.values(EDITION_PERSONAS)) personaDefinitionSchema.parse(def);
