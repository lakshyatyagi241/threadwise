import { z } from 'zod';
import {
  pageResponseSchema,
  permissionDefResponseSchema,
  roleResponseSchema,
  userResponseSchema,
  type CreateRoleInput,
  type CreateUserInput,
  type UpdateRoleInput,
  type UpdateUserInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const wsKeys = {
  roles: ['workspace-rbac', 'roles'] as const,
  permissions: ['workspace-rbac', 'permissions'] as const,
  users: ['workspace-rbac', 'users'] as const,
};

const permissionListSchema = z.object({ data: z.array(permissionDefResponseSchema) });

/** Follows `page.nextCursor` until the list is exhausted (a workspace has a handful of roles, tens of members). */
async function fetchAll<T>(
  path: string,
  item: z.ZodType<T>,
  signal?: AbortSignal,
  query: Record<string, string | number | undefined> = {},
): Promise<T[]> {
  const schema = pageResponseSchema(item);
  const out: T[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 200; guard += 1) {
    const page = await apiFetch(path, { query: { ...query, limit: 200, cursor }, schema, signal });
    out.push(...page.data);
    if (!page.page.hasMore || !page.page.nextCursor) return out;
    cursor = page.page.nextCursor;
  }
  return out;
}

export const fetchRoles = (signal?: AbortSignal) =>
  fetchAll('/roles', roleResponseSchema, signal, { order: 'asc' });
export const fetchUsers = (signal?: AbortSignal) =>
  fetchAll('/users', userResponseSchema, signal, { order: 'asc' });
export const fetchPermissions = (signal?: AbortSignal) =>
  apiFetch('/permissions', {
    query: { includeLocked: 1 },
    schema: permissionListSchema,
    signal,
  }).then((r) => r.data);

export const createRole = (body: CreateRoleInput) =>
  apiFetch('/roles', { method: 'POST', body, schema: roleResponseSchema });
export const updateRole = (id: string, body: UpdateRoleInput) =>
  apiFetch(`/roles/${id}`, { method: 'PATCH', body, schema: roleResponseSchema });
export const deleteRole = (id: string) => apiFetch(`/roles/${id}`, { method: 'DELETE' });

export const createUser = (body: CreateUserInput) =>
  apiFetch('/users', { method: 'POST', body, schema: userResponseSchema });
export const updateUser = (id: string, body: UpdateUserInput) =>
  apiFetch(`/users/${id}`, { method: 'PATCH', body, schema: userResponseSchema });
