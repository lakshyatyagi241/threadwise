import { z } from 'zod';
import {
  platformMyPermissionsSchema,
  platformPermissionListResponseSchema,
  platformPermissionSchema,
  platformRoleDetailSchema,
  platformRoleListResponseSchema,
  platformStaffListResponseSchema,
  platformStaffSchema,
  reassignRoleResponseSchema,
  type CreatePlatformPermissionInput,
  type CreatePlatformRoleInput,
  type PlatformRoleType,
  type ReassignRoleInput,
  type SetStaffRolesInput,
  type UpdatePlatformRoleInput,
} from '@crm/contracts';
import { operatorFetch } from '../../auth-registration-security/platform/operator-fetch';

/** DELETE /roles/:id and /permissions/:id answer with the name of what was removed (for the toast). */
const deletedSchema = z.object({ name: z.string() });

const ROOT = ['operator', 'rbac'] as const;

/** One cache namespace for the domain; a mutation invalidates the slice it changed. */
export const rbacKeys = {
  roles: [...ROOT, 'roles'] as const,
  roleList: (type: PlatformRoleType, search: string) =>
    [...ROOT, 'roles', 'list', type, search] as const,
  role: (id: string) => [...ROOT, 'roles', 'one', id] as const,
  permissions: [...ROOT, 'permissions'] as const,
  staff: [...ROOT, 'staff'] as const,
  me: [...ROOT, 'me'] as const,
};

export const fetchMyPermissions = (signal?: AbortSignal) =>
  operatorFetch('/me/permissions', { schema: platformMyPermissionsSchema, signal });

export const fetchRoles = (type: PlatformRoleType, search: string, signal?: AbortSignal) =>
  operatorFetch('/roles', {
    query: { type: type === 'all' ? undefined : type, search: search.trim() || undefined },
    schema: platformRoleListResponseSchema,
    signal,
  });

export const fetchRole = (id: string, signal?: AbortSignal) =>
  operatorFetch(`/roles/${id}`, { schema: platformRoleDetailSchema, signal });

export const fetchPermissions = (signal?: AbortSignal) =>
  operatorFetch('/permissions', { schema: platformPermissionListResponseSchema, signal });

export const fetchStaff = (signal?: AbortSignal) =>
  operatorFetch('/staff', { schema: platformStaffListResponseSchema, signal });

export const createRole = (body: CreatePlatformRoleInput) =>
  operatorFetch('/roles', { method: 'POST', body, schema: platformRoleDetailSchema });

export const updateRole = (id: string, body: UpdatePlatformRoleInput) =>
  operatorFetch(`/roles/${id}`, { method: 'PUT', body, schema: platformRoleDetailSchema });

export const duplicateRole = (id: string) =>
  operatorFetch(`/roles/${id}/duplicate`, { method: 'POST', schema: platformRoleDetailSchema });

export const reassignRole = (id: string, body: ReassignRoleInput) =>
  operatorFetch(`/roles/${id}/reassign`, {
    method: 'POST',
    body,
    schema: reassignRoleResponseSchema,
  });

export const deleteRole = (id: string) =>
  operatorFetch(`/roles/${id}`, { method: 'DELETE', schema: deletedSchema });

export const createPermission = (body: CreatePlatformPermissionInput) =>
  operatorFetch('/permissions', { method: 'POST', body, schema: platformPermissionSchema });

export const deletePermission = (id: string) =>
  operatorFetch(`/permissions/${id}`, { method: 'DELETE', schema: deletedSchema });

export const setStaffRoles = (id: string, body: SetStaffRolesInput) =>
  operatorFetch(`/staff/${id}/roles`, { method: 'PUT', body, schema: platformStaffSchema });
