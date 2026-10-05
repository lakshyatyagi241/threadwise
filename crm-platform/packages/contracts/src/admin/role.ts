import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { recordScopeSchema } from '../common/enums';

/**
 * Roles & Permissions — Settings > Users & Permissions.
 *
 * A role is a name plus a set of grants. Grant merge semantics (deny beats
 * allow, widest scope wins) live server-side in RbacService; this is just the
 * wire shape for defining them.
 */
export const permissionDefResponseSchema = z.object({
  key: z.string(),
  label: z.string(),
  category: z.string(),
  supportsScope: z.boolean(),
  /** The plan feature (add-on) this key belongs to; absent for core keys. */
  planFeature: z.string().nullable().optional(),
  /** The Marketplace app whose key this is; shown only while the workspace has it installed. */
  appSlug: z.string().nullable().optional(),
  /** Only with `?includeLocked=1`: why this key is not usable yet (its plan feature is off, or its app is not installed). */
  lock: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('plan_feature'), key: z.string() }),
      z.object({ kind: z.literal('app'), slug: z.string() }),
    ])
    .optional(),
});
export type PermissionDefResponse = z.infer<typeof permissionDefResponseSchema>;

export const roleGrantSchema = z.object({
  permissionKey: z.string(),
  effect: z.enum(['allow', 'deny']),
  recordScope: recordScopeSchema,
});
export type RoleGrant = z.infer<typeof roleGrantSchema>;

export const roleResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  systemKey: z.string().nullable(),
  isLocked: z.boolean(),
  grants: z.array(roleGrantSchema),
  /** Members holding the role. */
  userCount: z.number().int(),
  /** One of the five Reference presets (Owner, Admin, Manager, Agent, Viewer): never deleted, never renamed. */
  isPreset: z.boolean(),
  /** The caller may hand this role to a member (the member-role picker offers only these). */
  grantable: z.boolean(),
  /** The caller may change this role's permissions (not locked; the Owner and Admin presets only by an Owner). */
  editable: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RoleResponse = z.infer<typeof roleResponseSchema>;

export const createRoleSchema = z.object({
  name: z.string().min(1).max(120),
  grants: z.array(roleGrantSchema).default([]),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  /** Full replacement of the role's grant set, when present. */
  grants: z.array(roleGrantSchema).optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
