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

export const PLAN_LIMIT_GROUPS = ['messaging', 'workspace', 'content'] as const;
export type PlanLimitGroup = (typeof PLAN_LIMIT_GROUPS)[number];

/** Reference column in brackets: monthly_messages_limit, broadcast_limit, device_limit, user_seat_limit... */
export const PLAN_LIMIT_DEFS = [
  { key: 'monthly_messages', group: 'messaging' },
  { key: 'broadcasts', group: 'messaging' },
  // Scheduled messages the workspace holds, every status counted, deleted ones freed (TW-SCHED-019). 0 = unlimited.
  { key: 'scheduled_messages', group: 'messaging' },
  // Campaigns CREATED over the life of a plan period, deleted ones included (the delete-proof quota ledger, TW-PLAN-018). 0 = unlimited.
  { key: 'total_campaigns', group: 'messaging' },
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
  // Booking types, appointments and the public booking pages (TW-APPT-001). Default true: Reference's column default.
  { key: 'appointment_booking', group: 'advanced', default: true },
  // The website chatbot widget builder (TW-WGT-027). Default false: Reference's `access_chatbot_widgets` column default (its seeder turns it on for Growth and Pro).
  { key: 'chatbot_widgets', group: 'messaging', default: false },
  // Team inbox gates (plan-inbox-chat.md decision 11), with Reference's column defaults: SLA policies off, the other three on.
  { key: 'inbox_sla', group: 'messaging', default: false },
  { key: 'inbox_routing', group: 'messaging', default: true },
  { key: 'inbox_kanban', group: 'messaging', default: true },
  { key: 'team_performance', group: 'advanced', default: true },
  // Scheduled messages and the number warmer (TW-SCHED-019, 041). Default true: neither was gated here before, so every plan row that predates them keeps the area.
  { key: 'scheduled_messages', group: 'messaging', default: true },
  { key: 'whatsapp_warmer', group: 'messaging', default: true },
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
  inbox_sla: 'SLA policies',
  inbox_routing: 'Routing rules',
  inbox_kanban: 'Kanban view',
  team_performance: 'Team performance',
  scheduled_messages: 'Scheduled messages',
  whatsapp_warmer: 'WhatsApp warmer',
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
  'inbox_sla',
  'inbox_routing',
  'inbox_kanban',
  'team_performance',
  'scheduled_messages',
  'whatsapp_warmer',
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
