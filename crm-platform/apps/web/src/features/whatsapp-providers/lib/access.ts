/**
 * The platform permission keys the whatsapp-providers API enforces. The console asks `GET /v2/platform/me/permissions` and hides
 * what the caller lacks; the server stays the authority.
 */
export const WAP_PERMISSIONS = {
  view: 'platform.whatsapp-providers.view',
  manage: 'platform.whatsapp-providers.manage',
  assign: 'platform.whatsapp-providers.assign',
  switch: 'platform.whatsapp-providers.switch',
} as const;
export type WapPermission = keyof typeof WAP_PERMISSIONS;

export interface WapAccess {
  view: boolean;
  /** Create, edit, test, make default, enable and disable, delete. */
  manage: boolean;
  /** Set or clear a workspace's provider. */
  assign: boolean;
  /** Move channels between providers. */
  switch: boolean;
}

/**
 * One permission from the caller's map. A key the map does not list (not registered yet on an older API) falls back to the super
 * admin flag for writes and to "yes" for reading, so a missing registration never opens a write to a support or auditor role.
 */
export function holds(
  map: Readonly<Record<string, boolean>>,
  key: string,
  isSuperAdmin: boolean,
  isRead = false,
): boolean {
  if (key in map) return map[key] === true;
  return isRead ? true : isSuperAdmin;
}

export function accessFrom(
  map: Readonly<Record<string, boolean>>,
  isSuperAdmin: boolean,
): WapAccess {
  return {
    view: holds(map, WAP_PERMISSIONS.view, isSuperAdmin, true),
    manage: holds(map, WAP_PERMISSIONS.manage, isSuperAdmin),
    assign: holds(map, WAP_PERMISSIONS.assign, isSuperAdmin),
    switch: holds(map, WAP_PERMISSIONS.switch, isSuperAdmin),
  };
}

/** The most restrictive view: before the map has loaded nothing is offered. */
export const NO_ACCESS: WapAccess = { view: false, manage: false, assign: false, switch: false };
