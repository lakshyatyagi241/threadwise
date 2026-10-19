/**
 * Product modules a migrated workspace only keeps when the Waboo workspace had a permission in them (a live role with the Waboo
 * permission accessible, mapped by permission-map.json). A module with no such permission is closed for the preset roles (Owner, Admin,
 * Manager, Agent, Viewer): its menu entries, Settings tiles, screens and API routes go away. A key that is in no module here is never
 * touched (inbox, contacts, segments, groups, templates, campaigns, flows, settings, billing, team and the rest).
 * Written 2026-10-18 from the owner's request that a migrated workspace shows only what the old one had; the prefix lists are a draft,
 * please re-check. A TypeScript module, not a JSON file, so the bundle needs no extra file read.
 */
export const MODULE_CEILING: Record<string, string[]> = {
  companies: ['record.companies.', 'record.company-properties.'],
  'sales-docs': ['record.sales-docs.', 'record.sales-orders.', 'record.invoices.', 'record.recurring-invoices.', 'record.credit-notes.', 'record.payments.', 'record.tax-rates.'],
  deals: ['record.deals.', 'record.pipelines.'],
  tasks: ['record.tasks.'],
  appointments: ['record.appointments.', 'record.booking-types.'],
  forms: ['record.forms.', 'record.form-submissions.', 'wfl.', 'exam.'],
  'ai-crm': ['aicrm.', 'lsc.'],
  // AI agents (trained assistants and their knowledge): Waboo had no such area, so a migrated workspace only has it when a Waboo permission maps into it
  'ai-agents': ['aiag.'],
  email: ['mail.'],
  facebook: ['fb.'],
  instagram: ['ig.'],
  line: ['line.'],
  telegram: ['tg.'],
  viber: ['viber.'],
  wechat: ['wechat.'],
  sms: ['sms.'],
  store: ['store.', 'cat.', 'ecom.'],
  calling: ['call.'],
  'lead-sources': ['leads.'],
  warmer: ['sched.'],
  'team-chat': ['tchat.'],
  'website-chat': ['wgt.'],
};
