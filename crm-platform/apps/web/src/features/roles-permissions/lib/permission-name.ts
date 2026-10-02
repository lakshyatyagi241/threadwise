import { permissionNameSchema } from '@crm/contracts';

/** The 13 fixed modules Reference's create-permission form offers. */
export const PERMISSION_MODULES = [
  'users',
  'roles',
  'permissions',
  'workspaces',
  'metaads',
  'campaigns',
  'devices',
  'inbox',
  'billing',
  'audit',
  'security',
  'settings',
  'support',
] as const;

/** Lowercase, spaces to underscores: what the live preview shows and what the name auto-fills with. */
export const normaliseAction = (raw: string): string =>
  raw.trim().toLowerCase().replace(/\s+/g, '_');

/** `module.action`, with the placeholder words Reference shows until both are chosen. */
export function previewParts(module: string, action: string): { module: string; action: string } {
  return { module: module.trim() || 'module', action: normaliseAction(action) || 'action' };
}

/**
 * The name field follows module + action until the person edits it by hand (Reference's `userEditedName`);
 * it only fills once both are present.
 */
export function autofillName(args: {
  module: string;
  action: string;
  name: string;
  edited: boolean;
}): string {
  const action = normaliseAction(args.action);
  if (args.edited || !args.module || !action) return args.name;
  return `${args.module}.${action}`;
}

/** True when the name satisfies the registry's format (lowercase dotted segments). */
export const isValidPermissionName = (name: string): boolean =>
  permissionNameSchema.safeParse(name).success;
