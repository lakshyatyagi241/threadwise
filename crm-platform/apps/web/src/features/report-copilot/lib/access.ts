import type { OperatorRole } from '@crm/contracts';

/** The workspace permissions that gate the assistant (the library and chat, and changing the library). */
export const REPORT_READ_PERMISSION = 'dash.reports.read';
export const REPORT_MANAGE_PERMISSION = 'dash.reports.manage';

export interface ReportAccess {
  /** May see the library and use the chat. */
  canRead: boolean;
  /** May add and delete documents. */
  canManage: boolean;
}

/** Workspace: two permissions, as the API checks them. `permissions` is the session's map; absent means denied. */
export function workspaceAccess(permissions: Readonly<Record<string, unknown>>): ReportAccess {
  const canManage = REPORT_MANAGE_PERMISSION in permissions;
  return { canRead: REPORT_READ_PERMISSION in permissions, canManage };
}

/** Platform: a super admin and an auditor see it, only a super admin changes the library. Support never sees it. */
export function platformAccess(role: OperatorRole): ReportAccess {
  return {
    canRead: role === 'super_admin' || role === 'auditor',
    canManage: role === 'super_admin',
  };
}

/** The existing screen where the key the assistant needs is added. */
export const AI_KEYS_HREF: Record<'workspace' | 'platform', string> = {
  workspace: '/ai-keys',
  platform: '/admin/api-keys',
};

/**
 * What the chat's "+" menu item does: open the file picker for someone who may change the library, or explain why not for a viewer
 * (the item stays visible so the reason can be given).
 */
export const uploadMenuAction = (access: ReportAccess): 'pick' | 'explain' =>
  access.canManage ? 'pick' : 'explain';
