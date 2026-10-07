import type { OperatorRole } from '@crm/contracts';

/** Platform permission keys the hub's actions need (platform-staff keys, see PLATFORM_PERMISSION_KEYS). */
export const HUB_PERMISSIONS = {
  suspend: 'platform.workspace.suspend',
  unsuspend: 'platform.workspace.unsuspend',
  impersonate: 'platform.workspace.impersonate',
  manageProvider: 'platform.whatsapp_providers.manage',
} as const;

export type HubAction =
  'dashboard' | 'editPlan' | 'planLimits' | 'provider' | 'impersonate' | 'suspend' | 'unsuspend';

export type HubAccess = Record<HubAction, boolean>;

/**
 * What the caller may do, from their permission map (`GET /v2/platform/me/permissions`) and role. Editing a plan is a
 * super-admin action (the API guards it with the role, as the plans screen does); the rest use the platform keys.
 * The server stays the authority: this only decides what the menu offers. While the map is unknown nothing but the
 * dashboard is offered, so a denied call is never made.
 */
export function hubAccess(
  permissions: Readonly<Record<string, boolean>> | undefined,
  role: OperatorRole | undefined,
): HubAccess {
  const held = (key: string) => permissions?.[key] === true;
  const superAdmin = role === 'super_admin';
  return {
    dashboard: true,
    editPlan: superAdmin,
    planLimits: superAdmin,
    provider: held(HUB_PERMISSIONS.manageProvider),
    impersonate: held(HUB_PERMISSIONS.impersonate),
    suspend: held(HUB_PERMISSIONS.suspend),
    unsuspend: held(HUB_PERMISSIONS.unsuspend),
  };
}
