/**
 * The entitlement registry (WD-PLAN-006 / 007): every numeric cap and boolean
 * flag a plan can carry, declared once. The plan form, the validation, the
 * resolver and the onboarding chips all read this list, so a key cannot be
 * "declared in one list but not the other" (the trap WaDesk's package form
 * fell into). Adding a key here is the only code change a new gate needs.
 *
 * Limits: whole numbers, 0 = unlimited (WaDesk's rule: null, 0 and negatives
 * all meant unlimited; this catalogue stores 0 and treats an override of -1 as
 * unlimited too).
 */

export const PLAN_LIMIT_GROUPS = ['messaging', 'workspace', 'content'] as const;
export type PlanLimitGroup = (typeof PLAN_LIMIT_GROUPS)[number];

/** WaDesk column in brackets: monthly_messages_limit, broadcast_limit, device_limit, user_seat_limit... */
export const PLAN_LIMIT_DEFS = [
  { key: 'monthly_messages', group: 'messaging' },
  { key: 'broadcasts', group: 'messaging' },
  { key: 'devices', group: 'workspace' },
  { key: 'users', group: 'workspace' },
  { key: 'contacts', group: 'workspace' },
  { key: 'tags', group: 'workspace' },
  { key: 'pipelines', group: 'workspace' },
  // Appointments booked per calendar month of the booking's start (WD-APPT-035). 0 = unlimited.
  { key: 'appointments', group: 'workspace' },
  { key: 'templates', group: 'content' },
  { key: 'flows', group: 'content' },
  { key: 'autoreplies', group: 'content' },
] as const satisfies ReadonlyArray<{ key: string; group: PlanLimitGroup }>;

export type PlanLimitKey = (typeof PLAN_LIMIT_DEFS)[number]['key'];
export const PLAN_LIMIT_KEYS = PLAN_LIMIT_DEFS.map((d) => d.key) as PlanLimitKey[];

export const PLAN_FEATURE_GROUPS = ['messaging', 'aiCalling', 'integrations', 'advanced'] as const;
export type PlanFeatureGroup = (typeof PLAN_FEATURE_GROUPS)[number];

/**
 * `default` is what a plan row that predates a key is taken to grant (WaDesk's
 * column defaults), NOT what a new plan is pre-filled with: the create form
 * ticks everything, as WaDesk's wizard does.
 */
export const PLAN_FEATURE_DEFS = [
  { key: 'automation', group: 'messaging', default: false },
  { key: 'ai_assistants', group: 'aiCalling', default: true },
  { key: 'calling', group: 'aiCalling', default: false },
  { key: 'woocommerce', group: 'integrations', default: true },
  { key: 'shopify', group: 'integrations', default: true },
  { key: 'analytics', group: 'advanced', default: false },
  { key: 'remove_branding', group: 'advanced', default: false },
  // The deals + tasks + pipelines area (WD-DEAL-001). Default true: every plan row that predates the key keeps the area it had.
  { key: 'sales_pipeline', group: 'advanced', default: true },
  // Booking types, appointments and the public booking pages (WD-APPT-001). Default true: WaDesk's column default.
  { key: 'appointment_booking', group: 'advanced', default: true },
  // The website chatbot widget builder (WD-WGT-027). Default false: WaDesk's `access_chatbot_widgets` column default (its seeder turns it on for Growth and Pro).
  { key: 'chatbot_widgets', group: 'messaging', default: false },
] as const satisfies ReadonlyArray<{ key: string; group: PlanFeatureGroup; default: boolean }>;

export type PlanFeatureKey = (typeof PLAN_FEATURE_DEFS)[number]['key'];
export const PLAN_FEATURE_KEYS = PLAN_FEATURE_DEFS.map((d) => d.key) as PlanFeatureKey[];

/**
 * The order the onboarding card looks for its (at most three) feature chips:
 * Analytics, Automation, AI assistants, WooCommerce, Shopify, WhatsApp calling,
 * White-label (WD-AUTH-009). The first three a plan enables are shown.
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
];
export const PLAN_CHIP_MAX = 3;

export function isPlanFeatureKey(key: string): key is PlanFeatureKey {
  return (PLAN_FEATURE_KEYS as string[]).includes(key);
}
export function isPlanLimitKey(key: string): key is PlanLimitKey {
  return (PLAN_LIMIT_KEYS as string[]).includes(key);
}

/** Where a locked feature sends the person (the in-app plan picker, WD-PLAN-011). */
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
