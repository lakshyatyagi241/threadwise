import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Platform roles, the permission catalogue and staff role assignment: `/v2/platform/roles`, `/v2/platform/permissions`,
 * `/v2/platform/staff` (the operator console, WD-RBAC-001..013, 021). Platform layer: no organization is involved.
 */

/** The keys the code checks (the 16 of WD-RBAC-003, and the registry's three). The console reads the caller's map of these to hide what the server would refuse. */
export const PLATFORM_PERMISSION_KEYS = [
  'platform.workspace.view_all',
  'platform.workspace.suspend',
  'platform.workspace.unsuspend',
  'platform.workspace.impersonate',
  'platform.workspace.flag',
  'platform.workspace.unflag',
  'platform.conversation.view_all',
  'platform.conversation.flag_spam',
  'platform.note.write',
  'platform.audit.view',
  'platform.user.view_all',
  'platform.user.suspend',
  'platform.role.manage',
  'platform.permission.manage',
  'platform.billing.view',
  'platform.system.settings',
  // The WhatsApp provider registry: read it, change it (providers, defaults, workspace assignment), move a number to another provider.
  'platform.whatsapp_providers.view',
  'platform.whatsapp_providers.manage',
  'platform.whatsapp_providers.switch',
  // The Marketplace catalogue: operate it (listings, categories, hide, kill, requests), review (approve, reject, publish versions), and
  // decide what an app costs and who gets it free (prices, comps, cancelling a subscription).
  'platform.market.manage',
  'platform.market.review',
  'platform.market.pricing',
] as const;
export type PlatformPermissionKey = (typeof PLATFORM_PERMISSION_KEYS)[number];

// --- roles ---------------------------------------------------------------------------------------------------------

/** Lowercase dotted segments: `campaigns.send`, `platform.workspace.flag`. Tighter than WaDesk, which took any text. */
export const permissionNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(191)
  .regex(
    /^[a-z0-9_]+(\.[a-z0-9_]+)*$/,
    'Use lowercase letters, digits and underscores, with dots between parts.',
  );

export const roleNameSchema = z.string().trim().min(1, 'The role name is required.').max(191);
export const roleDescriptionSchema = z.string().trim().max(500).default('');

export const platformRoleTypeSchema = z.enum(['all', 'system', 'custom']);
export type PlatformRoleType = z.infer<typeof platformRoleTypeSchema>;

export const platformRoleListQuerySchema = z.object({
  type: platformRoleTypeSchema.default('all'),
  search: z.string().trim().max(100).optional(),
});
export type PlatformRoleListQuery = z.infer<typeof platformRoleListQuerySchema>;

export const platformRoleSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string(),
  isLocked: z.boolean(),
  /** The "System role" badge; every other role reads "Custom role". */
  isSystem: z.boolean(),
  userCount: z.number().int(),
  permissionCount: z.number().int(),
  updatedAt: z.string().datetime(),
});
export type PlatformRoleSummary = z.infer<typeof platformRoleSummarySchema>;

export const platformRoleListResponseSchema = z.object({
  data: z.array(platformRoleSummarySchema),
  kpis: z.object({
    totalRoles: z.number().int(),
    systemRoles: z.number().int(),
    customRoles: z.number().int(),
    totalPermissions: z.number().int(),
    /** Sum of per-role user counts: an operator holding two roles counts twice, as in WaDesk. */
    usersWithRole: z.number().int(),
    rolesWithoutUsers: z.number().int(),
  }),
});
export type PlatformRoleListResponse = z.infer<typeof platformRoleListResponseSchema>;

export const platformRoleDetailSchema = platformRoleSummarySchema.extend({
  /** Permission names the role holds. */
  permissions: z.array(z.string()),
  rowVersion: z.number().int(),
  /** Every other role, by name, for the reassign select. */
  otherRoles: z.array(z.object({ id: uuidSchema, name: z.string() })),
});
export type PlatformRoleDetail = z.infer<typeof platformRoleDetailSchema>;

export const createPlatformRoleSchema = z.object({
  name: roleNameSchema,
  description: roleDescriptionSchema,
  permissions: z.array(z.string().min(1).max(191)).max(500).default([]),
});
export type CreatePlatformRoleInput = z.infer<typeof createPlatformRoleSchema>;

export const updatePlatformRoleSchema = createPlatformRoleSchema.extend({
  rowVersion: z.number().int().positive(),
});
export type UpdatePlatformRoleInput = z.infer<typeof updatePlatformRoleSchema>;

export const reassignRoleSchema = z.object({ targetRoleId: uuidSchema });
export type ReassignRoleInput = z.infer<typeof reassignRoleSchema>;

export const reassignRoleResponseSchema = z.object({
  moved: z.number().int(),
  from: z.string(),
  to: z.string(),
});
export type ReassignRoleResponse = z.infer<typeof reassignRoleResponseSchema>;

// --- permissions ---------------------------------------------------------------------------------------------------

export const platformPermissionSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /** The text before the first dot; a name without a dot is its own module. */
  module: z.string(),
  isSystem: z.boolean(),
  roleCount: z.number().int(),
  createdAt: z.string().datetime(),
});
export type PlatformPermission = z.infer<typeof platformPermissionSchema>;

export const platformPermissionListResponseSchema = z.object({
  data: z.array(platformPermissionSchema),
  kpis: z.object({
    total: z.number().int(),
    modules: z.number().int(),
    usedInRoles: z.number().int(),
    orphans: z.number().int(),
    lastAdded: z.object({ name: z.string(), at: z.string().datetime() }).nullable(),
  }),
});
export type PlatformPermissionListResponse = z.infer<typeof platformPermissionListResponseSchema>;

/**
 * `module` + `action` compose the name when `name` has no dot (the console's auto-fill). Uniqueness and the format are
 * checked on the composed name, which WaDesk did not (it checked the raw field and then failed with a 500).
 */
export const createPlatformPermissionSchema = z.object({
  name: z.string().trim().min(1, 'The permission name is required.').max(191),
  module: z.string().trim().max(64).optional(),
  action: z.string().trim().max(64).optional(),
});
export type CreatePlatformPermissionInput = z.infer<typeof createPlatformPermissionSchema>;

// --- staff (WD-RBAC-021) -------------------------------------------------------------------------------------------

export const platformStaffSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  fullName: z.string(),
  /** The console access tier on the operator row (guards the danger actions). */
  tier: z.enum(['super_admin', 'support', 'auditor']),
  status: z.enum(['active', 'suspended']),
  roles: z.array(z.object({ id: uuidSchema, name: z.string() })),
});
export type PlatformStaff = z.infer<typeof platformStaffSchema>;

export const platformStaffListResponseSchema = z.object({
  data: z.array(platformStaffSchema),
  roles: z.array(z.object({ id: uuidSchema, name: z.string() })),
});
export type PlatformStaffListResponse = z.infer<typeof platformStaffListResponseSchema>;

export const setStaffRolesSchema = z.object({ roleIds: z.array(uuidSchema).max(50) });
export type SetStaffRolesInput = z.infer<typeof setStaffRolesSchema>;

// --- the caller's own map ------------------------------------------------------------------------------------------

export const platformMyPermissionsSchema = z.object({
  /** Every one of the 16 enforced keys, true when the caller holds it (WaDesk's bootstrap map). */
  permissions: z.record(z.string(), z.boolean()),
  roles: z.array(z.string()),
  isSuperAdmin: z.boolean(),
});
export type PlatformMyPermissions = z.infer<typeof platformMyPermissionsSchema>;
