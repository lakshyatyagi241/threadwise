/**
 * Error codes of the roles and permissions domain. Spread into ERROR_CODES (common/errors.ts) so the API and the web
 * branch on one registry; kept here so the domain owns its own vocabulary.
 */
export const RBAC_ERROR_CODES = {
  /** The role is system-locked (Super Admin): it cannot be renamed, stripped of permissions or deleted. */
  RBAC_ROLE_LOCKED: 'RBAC_ROLE_LOCKED',
  /** Another role already has this name (any case). */
  RBAC_ROLE_NAME_TAKEN: 'RBAC_ROLE_NAME_TAKEN',
  /** Another permission already has this name. */
  RBAC_PERMISSION_NAME_TAKEN: 'RBAC_PERMISSION_NAME_TAKEN',
  /** The permission is one the code checks (platform.*): deleting it would disable the check for everybody. */
  RBAC_PERMISSION_SYSTEM: 'RBAC_PERMISSION_SYSTEM',
  /** A submitted permission name is not in the catalogue (details: one `permissions` entry per name). */
  RBAC_PERMISSION_UNKNOWN: 'RBAC_PERMISSION_UNKNOWN',
  /** Reassign target equals the source role. */
  RBAC_REASSIGN_SAME_ROLE: 'RBAC_REASSIGN_SAME_ROLE',
  /** The change would leave no operator holding the Super Admin role. */
  RBAC_LAST_SUPER_ADMIN: 'RBAC_LAST_SUPER_ADMIN',
  /** Only a Super Admin may grant or revoke the Super Admin role. */
  RBAC_PRIVILEGED_ROLE: 'RBAC_PRIVILEGED_ROLE',
  /** The operator lacks the platform permission the route demands (details: the key). */
  RBAC_PLATFORM_PERMISSION_REQUIRED: 'RBAC_PLATFORM_PERMISSION_REQUIRED',
  /** The actor may not grant (or revoke) that role: "You don't have permission to grant the <role> role." */
  RBAC_ROLE_GRANT_FORBIDDEN: 'RBAC_ROLE_GRANT_FORBIDDEN',
  /** A member cannot change their own role. */
  RBAC_SELF_ROLE_CHANGE: 'RBAC_SELF_ROLE_CHANGE',
  /** The change would leave the organization without an Owner. */
  RBAC_LAST_OWNER: 'RBAC_LAST_OWNER',
  /** A preset role (Owner, Admin, Manager, Agent, Viewer) cannot be deleted or renamed. */
  RBAC_PRESET_ROLE: 'RBAC_PRESET_ROLE',
} as const;
