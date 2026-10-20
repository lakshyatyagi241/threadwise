import type { OperatorRole } from '@crm/contracts';

/**
 * Pages whose whole API is closed to some operator roles, so the menu does not offer a page that cannot open. The server stays the
 * authority (same as `operator-role.ts`); this only decides what the menu shows.
 *
 * Only pages whose controller carries the role guard on the CLASS belong here. Most operator controllers guard their write routes
 * only (`@OperatorRoles('super_admin')` on a POST or PUT) and leave the reads open to every role, so those pages are visible to all
 * three roles and show read-only controls. Pages gated by a finer permission key (`platform.market.*`, `platform.whatsapp_providers.*`,
 * `platform.role.manage`) are not here either: the operator session carries the role, not the keys.
 *
 * A page with no entry is visible to every role.
 */
const ONLY_ROLES: Readonly<Record<string, readonly OperatorRole[]>> = {
  // The whole platform/waba API is class-level super_admin only.
  'settings-whatsapp': ['super_admin'],
  // WabaThroughputController (platform/waba/throughput): class-level super_admin, reads included.
  'wa-throughput': ['super_admin'],
  // PlatformPlanAnalyticsController: class-level @OperatorRoles('super_admin') covers plan-analytics, financial and premium.
  'plan-analytics': ['super_admin'],
  financial: ['super_admin'],
  premium: ['super_admin'],
  // PlatformAiKeysController (platform/ai-keys): class-level super_admin. The AI usage dashboard is a separate, open controller.
  'ai-keys': ['super_admin'],
  // LeadScoringPlatformController (platform/lead-scoring): class-level super_admin, reads included (cost and usage).
  'lead-scoring': ['super_admin'],
  // WebhookFanoutController (platform/webhook-targets): class-level super_admin.
  'webhook-forwarding': ['super_admin'],
  // WabooMigrationController (platform/waboo-migration): class-level super_admin.
  'waboo-migration': ['super_admin'],
  // AdminDashController (platform/dashboard): class-level super_admin and auditor, so not support.
  'platform-analytics': ['super_admin', 'auditor'],
};

/** Whether the menu offers this page to an operator with this role. */
export const pageVisibleTo = (role: OperatorRole, id: string): boolean =>
  ONLY_ROLES[id]?.includes(role) ?? true;

/** The page ids that have a role restriction (for tests). */
export const restrictedPageIds = (): string[] => Object.keys(ONLY_ROLES);
