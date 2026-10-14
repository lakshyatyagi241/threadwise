/**
 * The entitlement registry (TW-PLAN-006 / 007): every numeric cap and boolean
 * flag a plan can carry, declared once. The plan form, the validation, the
 * resolver and the onboarding chips all read this list, so a key cannot be
 * "declared in one list but not the other" (the trap Reference's package form
 * fell into). Adding a key here is the only code change a new gate needs.
 *
 * Limits: whole numbers, 0 = unlimited (Reference's rule: null, 0 and negatives
 * all meant unlimited; this catalogue stores 0 and treats an override of -1 as
 * unlimited too).
 */

export const PLAN_LIMIT_GROUPS = [
  'messaging',
  'workspace',
  'content',
  'sales',
  'integrations',
  'ai',
] as const;
export type PlanLimitGroup = (typeof PLAN_LIMIT_GROUPS)[number];

/** Reference column in brackets: monthly_messages_limit, broadcast_limit, device_limit, user_seat_limit... */
export const PLAN_LIMIT_DEFS = [
  { key: 'monthly_messages', group: 'messaging' },
  { key: 'broadcasts', group: 'messaging' },
  // Scheduled messages the workspace holds, every status counted, deleted ones freed (TW-SCHED-019). 0 = unlimited.
  { key: 'scheduled_messages', group: 'messaging' },
  // Campaigns CREATED over the life of a plan period, deleted ones included (the delete-proof quota ledger, TW-PLAN-018). 0 = unlimited.
  { key: 'total_campaigns', group: 'messaging' },
  // Personal WhatsApp numbers (the unofficial engine). Kept so existing plans keep their value, but it only applies while the
  // platform switch `wa.unofficial.enabled` is on (owner decision 2026-10-05); with the switch off no device can be added or used.
  { key: 'devices', group: 'workspace' },
  { key: 'users', group: 'workspace' },
  { key: 'contacts', group: 'workspace' },
  { key: 'tags', group: 'workspace' },
  { key: 'pipelines', group: 'workspace' },
  // Appointments booked per calendar month of the booking's start (TW-APPT-035). 0 = unlimited.
  { key: 'appointments', group: 'workspace' },
  // Quick replies and routing rules of the team inbox (TW-TIB1 saved replies, TW-TIB2 routing). 0 = unlimited.
  { key: 'saved_replies', group: 'workspace' },
  { key: 'routing_rules', group: 'workspace' },
  { key: 'templates', group: 'content' },
  { key: 'flows', group: 'content' },
  { key: 'autoreplies', group: 'content' },
  // Customer REST API requests per minute per key (TW-PLAN-022). NOT like the other caps: 0 means "use the platform default", not unlimited;
  // a workspace override of -1 means unlimited.
  { key: 'api_rate_limit_per_minute', group: 'workspace' },
  // Marketplace apps and integrations a workspace has installed at once (spec marketplace-mini-apps-and-integrations, M-09). 0 = unlimited; counts what is installed now, an uninstall frees a place.
  { key: 'installed_apps', group: 'workspace' },
  // Lead sources (webhook doors into the lead pipeline) a workspace has at once (spec email-channel-and-social-leads, L-12). 0 = unlimited.
  { key: 'lead_sources', group: 'workspace' },
  // Audience size of ONE broadcast (contacts it would be sent to); a bigger audience is refused when the broadcast is created or edited. 0 = unlimited.
  { key: 'broadcast_recipients', group: 'messaging' },
  // Saved contact segments the workspace holds; deleted ones free the place. 0 = unlimited.
  { key: 'segments', group: 'workspace' },
  // Custom (non-system) fields across every module of the workspace; deleted ones free the place. 0 = unlimited.
  { key: 'custom_fields', group: 'workspace' },
  // Team chat channels (public and private) the workspace holds; deleted ones free the place. 0 = unlimited.
  { key: 'team_chat_channels', group: 'workspace' },
  // Inbox SLA policies the workspace holds; deleted ones free the place. 0 = unlimited.
  { key: 'sla_policies', group: 'workspace' },
  // Booking types (the public booking pages' event types) the workspace holds; deleted ones free the place. 0 = unlimited.
  { key: 'booking_types', group: 'workspace' },
  // Website chatbot widgets the workspace holds; deleted ones free the place. 0 = unlimited.
  { key: 'chatbot_widgets', group: 'content' },
  // Products in the WhatsApp catalog / storefront; deleted ones free the place. 0 = unlimited.
  { key: 'catalog_products', group: 'content' },
  // Invoices created per calendar month (every status, a deleted or voided one still counts for the month it was created in). 0 = unlimited.
  { key: 'invoices_monthly', group: 'sales' },
  // Recurring invoice schedules the workspace holds, every status; deleted ones free the place. 0 = unlimited.
  { key: 'recurring_invoices', group: 'sales' },
  // Active API keys of the workspace; a revoked key frees the place. 0 = unlimited.
  { key: 'api_keys', group: 'integrations' },
  // Outbound webhook endpoints the workspace holds (inbox webhooks and API webhooks together); deleted ones free the place. 0 = unlimited.
  { key: 'webhooks', group: 'integrations' },
  // Monthly AI token allowance of the workspace's assistants (counted by the AI token meter, ai-keys-usage-admin). Enforced there; the key name is
  // fixed because workspace overrides and the meter already read it. 0 = unlimited.
  { key: 'ai_token_limit_monthly', group: 'ai' },
  // The Forms add-on (docs/specs/forms-builder-app.md 12.3). Active web forms the workspace holds (archived ones free the place). 0 = unlimited.
  { key: 'forms', group: 'content' },
  // Web form submissions accepted per calendar month, spam excluded. Over the cap a submission is still stored (`needs_review: submissions_cap`), never dropped. 0 = unlimited.
  { key: 'form_submissions_monthly', group: 'content' },
  // AI form builder generations per calendar month, a repair retry included (counted from the AI builder's phase 2; registered now so plans carry it). 0 = unlimited.
  { key: 'ai_form_generations_monthly', group: 'ai' },
  // SMS messages sent per calendar month, counted per message (a three-segment text counts once), failed sends not counted (TW-SMS-026). 0 = unlimited.
  { key: 'sms_monthly', group: 'messaging' },
  // Connected Gmail mailboxes the workspace holds (the Email add-on; not disconnected ones). Default for a plan that has it: 3 (DEFAULT_EMAIL_MAILBOXES). 0 = unlimited.
  { key: 'email_mailboxes', group: 'messaging' },
] as const satisfies ReadonlyArray<{ key: string; group: PlanLimitGroup }>;

export type PlanLimitKey = (typeof PLAN_LIMIT_DEFS)[number]['key'];
export const PLAN_LIMIT_KEYS = PLAN_LIMIT_DEFS.map((d) => d.key) as PlanLimitKey[];

export const PLAN_FEATURE_GROUPS = ['messaging', 'aiCalling', 'integrations', 'advanced'] as const;
export type PlanFeatureGroup = (typeof PLAN_FEATURE_GROUPS)[number];

/**
 * `default` is what a plan row that predates a key is taken to grant (Reference's
 * column defaults), NOT what a new plan is pre-filled with: the create form
 * ticks everything, as Reference's wizard does.
 */
export const PLAN_FEATURE_DEFS = [
  { key: 'automation', group: 'messaging', default: false },
  { key: 'ai_assistants', group: 'aiCalling', default: true },
  { key: 'calling', group: 'aiCalling', default: false },
  { key: 'woocommerce', group: 'integrations', default: true },
  { key: 'shopify', group: 'integrations', default: true },
  { key: 'analytics', group: 'advanced', default: false },
  { key: 'remove_branding', group: 'advanced', default: false },
  // The deals + tasks + pipelines area (TW-DEAL-001). Default true: every plan row that predates the key keeps the area it had.
  { key: 'sales_pipeline', group: 'advanced', default: true },
  // Booking types, appointments and the public booking pages (TW-APPT-001). Default FALSE since the owner decided (2026-10-04) that
  // Appointments is the first paid first-party Marketplace app (listing `appointments`): the app owns this key, so no plan row that
  // predates it grants it. Reference's column default was true; workspaces that already used booking are comped (migration
  // `20261023090200_mkt_appointments_app.sql` and the operator's grandfather action).
  { key: 'appointment_booking', group: 'advanced', default: false },
  // The website chatbot widget builder (TW-WGT-027). Default false: Reference's `access_chatbot_widgets` column default (its seeder turns it on for Growth and Pro).
  { key: 'chatbot_widgets', group: 'messaging', default: false },
  // The WhatsApp catalog area (TW-CAT-001). Default false: Reference's `access_wa_storefront` column default.
  { key: 'wa_storefront', group: 'messaging', default: false },
  // Team inbox gates (plan-inbox-chat.md decision 11), with Reference's column defaults: SLA policies off, the other three on.
  { key: 'inbox_sla', group: 'messaging', default: false },
  { key: 'inbox_routing', group: 'messaging', default: true },
  // WhatsApp calling from the inbox (TW-CALL-003). Default true: no plan row held it here before, so every one that predates it keeps calling.
  { key: 'waba_calling', group: 'messaging', default: true },
  { key: 'inbox_kanban', group: 'messaging', default: true },
  { key: 'team_performance', group: 'advanced', default: true },
  // Scheduled messages and the number warmer (TW-SCHED-019, 041). Default true: neither was gated here before, so every plan row that predates them keeps the area.
  { key: 'scheduled_messages', group: 'messaging', default: true },
  { key: 'whatsapp_warmer', group: 'messaging', default: true },
  // The Marketplace of mini apps and integrations (M-09). Default true: no plan row held it before, so every one that predates it keeps the area.
  { key: 'marketplace', group: 'integrations', default: true },
  // Lead sources: webhook and connector doors that turn ad and portal leads into contacts and deals (L-12). Default true: no plan row held it before.
  { key: 'lead_sources', group: 'integrations', default: true },
  // Areas that had no plan gate before. All default true: no plan row held them, so every one that predates them keeps the area.
  { key: 'team_chat', group: 'advanced', default: true },
  { key: 'public_api', group: 'integrations', default: true },
  { key: 'outbound_webhooks', group: 'integrations', default: true },
  { key: 'storefront_builder', group: 'advanced', default: true },
  { key: 'invoicing', group: 'advanced', default: true },
  { key: 'forms_and_links', group: 'messaging', default: true },
  // Telegram, Facebook, Instagram and the other non-WhatsApp channels.
  { key: 'extra_channels', group: 'messaging', default: true },
  // The Forms add-on (Form Builder): hosted and embedded web forms that land in the CRM. Default FALSE: the Marketplace app `forms` owns this
  // key (`grants_plan_features`), so no plan row grants it and a default-on feature would be refused at publish. NOT `forms_and_links`, which
  // is Reference's WhatsApp Flows forms and stays on by default.
  { key: 'form_builder', group: 'advanced', default: false },
  // WhatsApp Groups on a Cloud API number (BL-094, docs/specs/waba-groups-management.md 13). Reference had NO plan gate on its Groups page; the
  // owner decided (2026-10-08) it is a plan feature and not in every plan, so it defaults to FALSE and a plan must be given it.
  { key: 'waba_groups', group: 'messaging', default: false },
  // The SMS channel (Twilio and MSG91, send-only; TW-SMS-025). Default false: Reference's `access_sms` column default.
  { key: 'sms', group: 'messaging', default: false },
  // The in-app assistant that guides or does a task on the person's own session (docs/specs/help-agent-assistant.md). Default false: it
  // spends AI tokens, so the owner hands it to chosen plans; the workspace switch and the `help.agent.use` permission are separate gates.
  { key: 'help_agent', group: 'aiCalling', default: false },
  // The Email (Gmail) channel add-on: connect Gmail mailboxes into the team inbox. Default FALSE: the Marketplace app `email` owns this key (`grants_plan_features`).
  { key: 'email_channel', group: 'messaging', default: false },
  // The FULL history choice of the opt-in import of a personal WhatsApp number (TW-WAHIST; owner decision 2026-10-14). The `recent` choice is open to every workspace that
  // may use personal numbers; only `full` needs this. Default false, switched on for the plans with the most generous personal-number allowance (migration 20261203090000).
  { key: 'personal_history_full', group: 'messaging', default: false },
] as const satisfies ReadonlyArray<{ key: string; group: PlanFeatureGroup; default: boolean }>;

export type PlanFeatureKey = (typeof PLAN_FEATURE_DEFS)[number]['key'];

/** The words a lock message and the paywall sheet use for a feature (TW-PLAN-019 rule 5). */
export const PLAN_FEATURE_LABELS: Record<PlanFeatureKey, string> = {
  automation: 'Automation',
  ai_assistants: 'AI assistants',
  calling: 'WhatsApp calling',
  woocommerce: 'WooCommerce',
  shopify: 'Shopify',
  analytics: 'Analytics',
  remove_branding: 'White-label branding',
  sales_pipeline: 'Sales pipeline',
  appointment_booking: 'Appointment booking',
  chatbot_widgets: 'Chatbot widgets',
  wa_storefront: 'WhatsApp catalog',
  inbox_sla: 'SLA policies',
  inbox_routing: 'Routing rules',
  waba_calling: 'WhatsApp calling',
  inbox_kanban: 'Kanban view',
  team_performance: 'Team performance',
  scheduled_messages: 'Scheduled messages',
  whatsapp_warmer: 'WhatsApp warmer',
  marketplace: 'Marketplace',
  lead_sources: 'Lead sources',
  team_chat: 'Team chat',
  public_api: 'Public API',
  outbound_webhooks: 'Outbound webhooks',
  storefront_builder: 'Storefront builder',
  invoicing: 'Invoicing',
  forms_and_links: 'Forms and links',
  extra_channels: 'Telegram, Facebook and Instagram channels',
  form_builder: 'Forms',
  waba_groups: 'WhatsApp groups',
  sms: 'SMS channel',
  help_agent: 'Help assistant',
  email_channel: 'Email (Gmail) channel',
  personal_history_full: 'Full history import (personal WhatsApp)',
};
export const PLAN_FEATURE_KEYS = PLAN_FEATURE_DEFS.map((d) => d.key) as PlanFeatureKey[];

/**
 * The order the onboarding card looks for its (at most three) feature chips:
 * Analytics, Automation, AI assistants, WooCommerce, Shopify, WhatsApp calling,
 * White-label (TW-AUTH-009). The first three a plan enables are shown.
 */
export const PLAN_CHIP_ORDER: readonly PlanFeatureKey[] = [
  'analytics',
  'automation',
  'ai_assistants',
  'woocommerce',
  'shopify',
  'calling',
  'remove_branding',
  'sales_pipeline',
  'appointment_booking',
  'chatbot_widgets',
  'wa_storefront',
  'inbox_sla',
  'inbox_routing',
  'waba_calling',
  'inbox_kanban',
  'team_performance',
  'scheduled_messages',
  'whatsapp_warmer',
  'marketplace',
  'lead_sources',
  'team_chat',
  'public_api',
  'outbound_webhooks',
  'storefront_builder',
  'invoicing',
  'forms_and_links',
  'extra_channels',
  'form_builder',
  'waba_groups',
  'sms',
  'help_agent',
  'email_channel',
  'personal_history_full',
];
export const PLAN_CHIP_MAX = 3;

export function isPlanFeatureKey(key: string): key is PlanFeatureKey {
  return (PLAN_FEATURE_KEYS as string[]).includes(key);
}
export function isPlanLimitKey(key: string): key is PlanLimitKey {
  return (PLAN_LIMIT_KEYS as string[]).includes(key);
}

/** Where a locked feature sends the person (the in-app plan picker, TW-PLAN-011). */
export const PLAN_UPGRADE_PATH = '/account/plans';

/**
 * A flag as stored on a plan row: the stored value, else the registry default.
 * (A key added to the registry after a plan was saved must not silently lock
 * or unlock existing plans beyond what its declared default says.)
 */
export function storedFeature(raw: unknown, key: PlanFeatureKey): boolean {
  const value =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[key] : undefined;
  if (typeof value === 'boolean') return value;
  return PLAN_FEATURE_DEFS.find((d) => d.key === key)!.default;
}

/** A cap as stored on a plan row: whole number, 0 = unlimited (anything else reads as 0). */
export function storedLimit(raw: unknown, key: PlanLimitKey): number {
  const value =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[key] : undefined;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}
