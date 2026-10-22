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
  // Emails sent per calendar month, replies and campaign mails together (Reference's `email_monthly_limit`). Enforced by the email campaign sender. 0 = unlimited.
  { key: 'email_monthly', group: 'messaging' },
  // Storage the workspace may hold, in whole GB (1 GB = 2^30 bytes): call recordings, chat media, mail attachments, contact files and the other counted kinds
  // (docs/specs/storage-quota-and-archival.md section 5.1). 0 = unlimited, so a plan row that predates the key is not limited by it. MEASURED ONLY for now
  // (phase S1, observe mode): nothing is refused until enforcement ships (phase S2).
  { key: 'storage_gb', group: 'workspace' },
  // Teams the workspace may hold (docs/specs/teams-unification.md D4, BL-383). NOT like most caps: a stored 0 means "solo, no teams" (see
  // PLAN_LIMITS_ZERO_IS_NONE); a plan row that predates the key, or one that stores PLAN_UNLIMITED_FROM or more, means unlimited, so no
  // existing plan changes. The Teams and permissions add-on raises it (its `teams` is a number of extra teams, -1 = unlimited).
  { key: 'teams', group: 'workspace' },
] as const satisfies ReadonlyArray<{ key: string; group: PlanLimitGroup }>;

export type PlanLimitKey = (typeof PLAN_LIMIT_DEFS)[number]['key'];
export const PLAN_LIMIT_KEYS = PLAN_LIMIT_DEFS.map((d) => d.key) as PlanLimitKey[];

/**
 * Caps where a stored 0 is a REAL value ("none allowed"), not unlimited. Every other cap keeps the rule above (0 = unlimited). For these
 * keys a plan row that does not carry the key reads as unlimited (PLAN_UNLIMITED_FROM), so adding the key changed no existing plan.
 * `teams`: 0 = solo (no teams can be created).
 */
export const PLAN_LIMITS_ZERO_IS_NONE: readonly PlanLimitKey[] = ['teams'];
export const limitZeroIsNone = (key: string): boolean =>
  (PLAN_LIMITS_ZERO_IS_NONE as readonly string[]).includes(key);

/**
 * The keys a plain add-on pack (one that is not a Marketplace app) may grant inside the one entitlement resolver every gate asks. The list is
 * deliberately short: any other pack keeps going through the add-on registry's own resolver, exactly as before. The "Teams and permissions"
 * add-on (BL-383) grants the two features and raises the `teams` cap; the "Smart routing" add-on grants `inbox_routing` (automatic assignment)
 * and `inbox_assignment_sticky` (contact owner and sticky agent), docs/specs/packaging-teams-and-smart-routing.md.
 */
export const PACK_GRANTABLE_FEATURES: readonly string[] = [
  'team_hierarchy',
  'custom_roles',
  'inbox_routing',
  'inbox_assignment_sticky',
];

/**
 * Flags a NEW plan starts without in the operator's plan form (everything else starts on, Reference's rule). They match the registry default
 * (false) on purpose: the form writes every key, so a plan saved from it stores them explicitly either way. These two are sold as the "Smart
 * routing" add-on (or switched on per plan, which the operator does for the higher tiers).
 */
export const NEW_PLAN_FEATURES_OFF: readonly string[] = [
  'inbox_routing',
  'inbox_assignment_sticky',
  'appointment_confirm_buttons',
  'appointment_rebook_steps',
];
export const PACK_GRANTABLE_LIMITS: readonly string[] = ['teams'];

export const PLAN_FEATURE_GROUPS = ['messaging', 'aiCalling', 'integrations', 'advanced'] as const;
export type PlanFeatureGroup = (typeof PLAN_FEATURE_GROUPS)[number];

/**
 * The product lines a plan feature belongs to (docs/specs/teams-unification.md 5.6): ONE product that fuses a conversation side and a
 * sales side. `chat` is the conversation side (inbox, channels, team chat, calling, broadcasts' channels), `crm` the sales side (deals,
 * invoicing, lead sources, assignment, scoring, forms), `platform` what both share (automation, analytics, API, marketplace, teams and roles).
 * An edition (Chat, Sales CRM, Both) is just a plan, add-on and persona with the right keys on: nothing in the code branches on a plan name.
 */
export const PLAN_PRODUCT_LINES = ['chat', 'crm', 'platform'] as const;
export type PlanProductLine = (typeof PLAN_PRODUCT_LINES)[number];

/**
 * `default` is what a plan row that predates a key is taken to grant (Reference's
 * column defaults), NOT what a new plan is pre-filled with: the create form
 * ticks everything, as Reference's wizard does.
 */
export const PLAN_FEATURE_DEFS = [
  { key: 'automation', group: 'messaging', productLine: 'platform', default: false },
  { key: 'ai_assistants', group: 'aiCalling', productLine: 'platform', default: true },
  { key: 'calling', group: 'aiCalling', productLine: 'chat', default: false },
  { key: 'woocommerce', group: 'integrations', productLine: 'platform', default: true },
  { key: 'shopify', group: 'integrations', productLine: 'platform', default: true },
  { key: 'analytics', group: 'advanced', productLine: 'platform', default: false },
  { key: 'remove_branding', group: 'advanced', productLine: 'platform', default: false },
  // The deals + tasks + pipelines area (TW-DEAL-001). Default true: every plan row that predates the key keeps the area it had.
  { key: 'sales_pipeline', group: 'advanced', productLine: 'crm', default: true },
  // Booking types, appointments and the public booking pages (TW-APPT-001). Default FALSE since the owner decided (2026-10-04) that
  // Appointments is the first paid first-party Marketplace app (listing `appointments`): the app owns this key, so no plan row that
  // predates it grants it. Reference's column default was true; workspaces that already used booking are comped (migration
  // `20261023090200_mkt_appointments_app.sql` and the operator's grandfather action).
  { key: 'appointment_booking', group: 'advanced', productLine: 'crm', default: false },
  // Parts of a reminder sequence (BL-428): the Confirm / Reschedule / Cancel buttons on the 24 hour reminder and the rebook (recall)
  // steps. Default FALSE since the owner decision of 2026-10-22 (no paying clients yet): they are the UPGRADE TIER of the Appointments app
  // (timed WhatsApp and email reminders, packs, test email, fallback, report and history come with `appointment_booking`). Both need
  // `appointment_booking`. The app listing grants only `appointment_booking`, so these two are per-plan switches (plan Features tab).
  { key: 'appointment_confirm_buttons', group: 'advanced', productLine: 'crm', default: false },
  { key: 'appointment_rebook_steps', group: 'advanced', productLine: 'crm', default: false },
  // The website chatbot widget builder (TW-WGT-027). Default false: Reference's `access_chatbot_widgets` column default (its seeder turns it on for Growth and Pro).
  { key: 'chatbot_widgets', group: 'messaging', productLine: 'chat', default: false },
  // The WhatsApp catalog area (TW-CAT-001). Default false: Reference's `access_wa_storefront` column default.
  { key: 'wa_storefront', group: 'messaging', productLine: 'chat', default: false },
  // Team inbox gates (plan-inbox-chat.md decision 11), with Reference's column defaults: SLA policies off, the other three on.
  { key: 'inbox_sla', group: 'messaging', productLine: 'chat', default: false },
  // Sold as the "Smart routing" add-on (a pack may grant it) or switched on per plan. Default FALSE: the entry plan has no automatic assignment. A plan row
  // that does not store the key reads this default (storedFeature), so a plan must store `true` to include it; the sample plans and the operator's plan
  // form do. Owner decision 2026-10-22: no paying clients yet, existing ones are migrated onto plans that carry what they have.
  { key: 'inbox_routing', group: 'messaging', productLine: 'chat', default: false },
  // Owner first, keep in sync and the continuity window for the last handler (BL-402, docs/specs/conversation-handoff-and-assignment.md 7).
  // Effective only together with `inbox_routing`. Default false, with the other Smart routing flag (see above).
  { key: 'inbox_assignment_sticky', group: 'messaging', productLine: 'chat', default: false },
  // WhatsApp calling from the inbox (TW-CALL-003). Default true: no plan row held it here before, so every one that predates it keeps calling.
  { key: 'waba_calling', group: 'messaging', productLine: 'chat', default: true },
  { key: 'inbox_kanban', group: 'messaging', productLine: 'chat', default: true },
  { key: 'team_performance', group: 'advanced', productLine: 'chat', default: true },
  // Scheduled messages and the number warmer (TW-SCHED-019, 041). Default true: neither was gated here before, so every plan row that predates them keeps the area.
  { key: 'scheduled_messages', group: 'messaging', productLine: 'chat', default: true },
  { key: 'whatsapp_warmer', group: 'messaging', productLine: 'chat', default: true },
  // The Marketplace of mini apps and integrations (M-09). Default true: no plan row held it before, so every one that predates it keeps the area.
  { key: 'marketplace', group: 'integrations', productLine: 'platform', default: true },
  // Lead sources: webhook and connector doors that turn ad and portal leads into contacts and deals (L-12). Default true: no plan row held it before.
  { key: 'lead_sources', group: 'integrations', productLine: 'crm', default: true },
  // Areas that had no plan gate before. All default true: no plan row held them, so every one that predates them keeps the area.
  { key: 'team_chat', group: 'advanced', productLine: 'chat', default: true },
  { key: 'public_api', group: 'integrations', productLine: 'platform', default: true },
  { key: 'outbound_webhooks', group: 'integrations', productLine: 'platform', default: true },
  { key: 'storefront_builder', group: 'advanced', productLine: 'platform', default: true },
  { key: 'invoicing', group: 'advanced', productLine: 'crm', default: true },
  { key: 'forms_and_links', group: 'messaging', productLine: 'chat', default: true },
  // Telegram, Facebook, Instagram and the other non-WhatsApp channels.
  { key: 'extra_channels', group: 'messaging', productLine: 'chat', default: true },
  // The Forms add-on (Form Builder): hosted and embedded web forms that land in the CRM. Default FALSE: the Marketplace app `forms` owns this
  // key (`grants_plan_features`), so no plan row grants it and a default-on feature would be refused at publish. NOT `forms_and_links`, which
  // is Reference's WhatsApp Flows forms and stays on by default.
  { key: 'form_builder', group: 'advanced', productLine: 'crm', default: false },
  // WhatsApp Groups on a Cloud API number (BL-094, docs/specs/waba-groups-management.md 13). Reference had NO plan gate on its Groups page; the
  // owner decided (2026-10-08) it is a plan feature and not in every plan, so it defaults to FALSE and a plan must be given it.
  { key: 'waba_groups', group: 'messaging', productLine: 'chat', default: false },
  // The SMS channel (Twilio and MSG91, send-only; TW-SMS-025). Default false: Reference's `access_sms` column default.
  { key: 'sms', group: 'messaging', productLine: 'chat', default: false },
  // The in-app assistant that guides or does a task on the person's own session (docs/specs/help-agent-assistant.md). Default false: it
  // spends AI tokens, so the owner hands it to chosen plans; the workspace switch and the `help.agent.use` permission are separate gates.
  { key: 'help_agent', group: 'aiCalling', productLine: 'platform', default: false },
  // The Email (Gmail) channel add-on: connect Gmail mailboxes into the team inbox. Default FALSE: the Marketplace app `email` owns this key (`grants_plan_features`).
  { key: 'email_channel', group: 'messaging', productLine: 'chat', default: false },
  // The FULL history choice of the opt-in import of a personal WhatsApp number (TW-WAHIST; owner decision 2026-10-14). The `recent` choice is open to every workspace that
  // may use personal numbers; only `full` needs this. Default false, switched on for the plans with the most generous personal-number allowance (migration 20261204090100).
  { key: 'personal_history_full', group: 'messaging', productLine: 'chat', default: false },
  // The AI CRM Copilot (TW-AICRM-016): a chat assistant that runs the CRM by tool-calling. Default false: it spends AI tokens like `help_agent`,
  // so the owner hands it to chosen plans. Reference's `access_ai_agents` column — deliberately NOT `ai_assistants` (Reference's own, different,
  // `access_ai_chat_assistant` flag already mapped to that key for the AI Training/chat-assistants domain).
  { key: 'ai_crm_copilot', group: 'aiCalling', productLine: 'crm', default: false },
  // AI lead scoring and the growth pilot built on it (Marketplace app `lead-scoring`). Default FALSE: the app owns this key (`grants_plan_features`).
  // The workspaces that already used scoring keep it through a per-workspace override written by migration 20261228090000, then the operator's comp.
  { key: 'lead_scoring', group: 'aiCalling', productLine: 'crm', default: false },
  // Record assignment rules (BL-340..345): rules that give new contacts, companies and deals to sales owners (Settings > Automation). Default FALSE and
  // switched on by migration 20270115090000 only for the higher plans (the ones that already carry SLA policies); the basic plan does not get it.
  { key: 'record_assignment', group: 'advanced', productLine: 'crm', default: false },
  // Teams and permissions packaging (docs/specs/teams-unification.md 5.6 and decision D4; BL-383). Both default TRUE: every plan row that predates them
  // keeps parent teams, lead/manager scope, custom roles and per-key scopes. An operator switches them off on a plan, or sells them in the
  // "Teams and permissions" add-on (a pack may grant them, see PACK_GRANTABLE_FEATURES).
  { key: 'team_hierarchy', group: 'advanced', productLine: 'platform', default: true },
  { key: 'custom_roles', group: 'advanced', productLine: 'platform', default: true },
] as const satisfies ReadonlyArray<{
  key: string;
  group: PlanFeatureGroup;
  /** Which side of the one product the feature belongs to; editions are made from it as data (see PLAN_PRODUCT_LINES). */
  productLine: PlanProductLine;
  default: boolean;
}>;

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
  appointment_confirm_buttons: 'Appointment reminders: Confirm / Reschedule / Cancel buttons',
  appointment_rebook_steps: 'Appointment reminders: rebook (recall) steps',
  chatbot_widgets: 'Chatbot widgets',
  wa_storefront: 'WhatsApp catalog',
  inbox_sla: 'SLA policies',
  inbox_routing: 'Smart routing: auto-assignment and rules',
  inbox_assignment_sticky: 'Smart routing: contact owner and sticky agent',
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
  extra_channels: 'Telegram, Facebook, Instagram, LINE, Viber and WeChat channels',
  form_builder: 'Forms',
  waba_groups: 'WhatsApp groups',
  sms: 'SMS channel',
  help_agent: 'Help assistant',
  email_channel: 'Email (Gmail) channel',
  personal_history_full: 'Full history import (personal WhatsApp)',
  ai_crm_copilot: 'AI CRM Copilot',
  lead_scoring: 'AI lead scoring',
  record_assignment: 'Record assignment rules',
  team_hierarchy: 'Team hierarchy and manager scope',
  custom_roles: 'Custom roles and scoped permissions',
};
export const PLAN_FEATURE_KEYS = PLAN_FEATURE_DEFS.map((d) => d.key) as PlanFeatureKey[];

/** The product line of a plan feature key (the registry is the only place it is declared). */
export function planFeatureLine(key: PlanFeatureKey): PlanProductLine {
  return PLAN_FEATURE_DEFS.find((d) => d.key === key)!.productLine;
}

/** The feature keys of one product line, in registry order. */
export function planFeaturesOfLine(line: PlanProductLine): PlanFeatureKey[] {
  return PLAN_FEATURE_DEFS.filter((d) => d.productLine === line).map((d) => d.key);
}

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
  'appointment_confirm_buttons',
  'appointment_rebook_steps',
  'chatbot_widgets',
  'wa_storefront',
  'inbox_sla',
  'inbox_routing',
  'inbox_assignment_sticky',
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
  'ai_crm_copilot',
  'lead_scoring',
  'record_assignment',
  'team_hierarchy',
  'custom_roles',
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
  if (limitZeroIsNone(key)) {
    // 0 is a real cap here; a missing or malformed value is "no cap" (the row predates the key).
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? value
      : PLAN_UNLIMITED_FROM;
  }
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * A cap this big is a stand-in for "no cap" (the plan catalogue and the migrated workspaces store 1,000,000 or 100,000,000 where
 * Reference said unlimited). The stored value is kept; every screen reads it through {@link isUnlimitedLimit} and prints "Unlimited".
 */
export const PLAN_UNLIMITED_FROM = 1_000_000;

/** 0 (or less) and an effectively unlimited value are both "no cap". */
export const isUnlimitedLimit = (limit: number): boolean =>
  !Number.isFinite(limit) || limit <= 0 || limit >= PLAN_UNLIMITED_FROM;

/** Whether a stored cap value is an actual cap (counts as "set" in the plan tables); `teams` 0 is a cap (solo), other caps' 0 is not. */
export const isLimitCapped = (key: string, limit: number): boolean =>
  limitZeroIsNone(key) ? !isUnlimitedFor(key, limit) : limit > 0;

/** {@link isUnlimitedLimit} for a named cap: for a zero-is-none cap (`teams`) a 0 is "none", and only a huge value is unlimited. */
export const isUnlimitedFor = (key: string, limit: number): boolean =>
  limitZeroIsNone(key)
    ? !Number.isFinite(limit) || limit >= PLAN_UNLIMITED_FROM
    : isUnlimitedLimit(limit);
