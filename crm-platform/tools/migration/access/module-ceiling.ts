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
  'sales-docs': [
    'record.sales-docs.',
    'record.sales-orders.',
    'record.invoices.',
    'record.recurring-invoices.',
    'record.credit-notes.',
    'record.payments.',
    'record.tax-rates.',
  ],
  deals: ['record.deals.', 'record.pipelines.'],
  // Task outcomes and the Sales Activities page are part of tasks: they close with it
  tasks: ['record.tasks.', 'settings.task_outcomes.', 'crm.activity_types.'],
  appointments: ['record.appointments.', 'record.booking-types.', 'appointments.'],
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
  // the unofficial engine (QR / pairing code numbers, their groups): Waboo never had it, so a migrated workspace never gets it
  'unofficial-whatsapp': ['wa.devices.', 'wa.groups.'],
  // the TikTok channel (a "coming soon" tile today): not part of what a Waboo workspace had
  tiktok: ['chn.tiktok.'],
  // the "All channels" hub (a "coming soon" tile today): not part of what a Waboo workspace had
  channels: ['chn.channels.'],
  // the CRM dashboard (the sidebar's CRM entry): a Desk page the Waboo workspace never had, though its deals stay
  'crm-dashboard': ['dash.crm.'],
  // the "Privacy and data" placeholder (Settings > Data and security): not part of what a Waboo workspace had; the live Data requests
  // screen is privacy.requests.* and stays
  'privacy-data': ['privacy.data.'],
  // the AI Studio start page: a Desk page that Waboo never had (always closed for a migrated workspace, see NEVER_KEPT)
  'ai-studio': ['flb.ai_studio.'],
};
