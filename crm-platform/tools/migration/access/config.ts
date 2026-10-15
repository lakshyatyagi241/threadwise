import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two operator-reviewed files that decide what a migrated role may do. Both are checked in and hold no customer data (Waboo
 * permission ids and role ids only). Nothing is guessed: whatever the files do not say grants nothing.
 */
export type Scope = 'all' | 'own' | 'team';
export const PRESET_TARGETS = ['manager', 'agent', 'viewer', 'workspace_admin'] as const;
export type PresetTarget = (typeof PRESET_TARGETS)[number];

export interface PermissionMapEntry {
  /** Only REVIEWED entries (with a named reviewer) are applied. Anything else behaves as if the permission were not mapped. */
  status: 'REVIEWED' | 'UNREVIEWED';
  reviewedBy?: string;
  create?: string[];
  read?: string[];
  update?: string[];
  delete?: string[];
  /** For a Waboo permission without CRUD flags: is_accessible grants these. */
  use?: string[];
  scope?: Scope | null;
  note?: string;
}
export interface PermissionCandidate {
  /** Case-insensitive pattern on the Waboo permission id, name or label. */
  match: string;
  area: string;
  suggest: Record<string, string[]>;
  status: 'UNREVIEWED';
}
export interface PermissionMap {
  version: 1;
  entries: Record<string, PermissionMapEntry>;
  candidates?: PermissionCandidate[];
}
export interface RoleMapEntry {
  to: 'custom' | `preset:${PresetTarget}`;
  approvedBy?: string;
  evidence?: string;
  /** Custom roles only: keep admin-class keys the map would otherwise withhold. Needs approvedBy. */
  allowAdminClass?: boolean;
}
export interface AccessConfig {
  permissionMap: PermissionMap;
  /** client -> Waboo role id (either key) -> decision */
  roleMap: Record<string, Record<string, RoleMapEntry>>;
}

export class AccessConfigError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const strList = (v: unknown, where: string): string[] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x.trim() === ''))
    throw new AccessConfigError(`${where}: must be a list of permission keys`);
  return v as string[];
};
const named = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 1;

/** Validates both files. Throws before anything is written: a bad map must stop the run, not be skipped. */
export function parseAccessConfig(permissionMap: unknown, roleMap: unknown): AccessConfig {
  if (!isObj(permissionMap) || !isObj(permissionMap.entries))
    throw new AccessConfigError('permission-map.json: expected { version, entries }');
  const entries: Record<string, PermissionMapEntry> = {};
  for (const [id, raw] of Object.entries(permissionMap.entries)) {
    if (!isObj(raw))
      throw new AccessConfigError(`permission-map.json: entry ${id} is not an object`);
    const status = raw.status === 'REVIEWED' ? 'REVIEWED' : 'UNREVIEWED';
    if (status === 'REVIEWED' && !named(raw.reviewedBy))
      throw new AccessConfigError(`permission-map.json: REVIEWED entry ${id} needs reviewedBy`);
    const scope = raw.scope ?? null;
    if (scope !== null && !['all', 'own', 'team'].includes(String(scope)))
      throw new AccessConfigError(
        `permission-map.json: entry ${id}: scope must be all, own or team`,
      );
    entries[id] = {
      status,
      reviewedBy: raw.reviewedBy as string | undefined,
      create: strList(raw.create, `${id}.create`),
      read: strList(raw.read, `${id}.read`),
      update: strList(raw.update, `${id}.update`),
      delete: strList(raw.delete, `${id}.delete`),
      use: strList(raw.use, `${id}.use`),
      scope: scope as Scope | null,
      note: typeof raw.note === 'string' ? raw.note : undefined,
    };
  }
  const roles: AccessConfig['roleMap'] = {};
  const clients = isObj(roleMap) && isObj(roleMap.clients) ? roleMap.clients : null;
  if (!clients) throw new AccessConfigError('role-map.json: expected { version, clients }');
  for (const [client, byRole] of Object.entries(clients)) {
    if (!isObj(byRole))
      throw new AccessConfigError(`role-map.json: client ${client} is not an object`);
    roles[client] = {};
    for (const [roleId, raw] of Object.entries(byRole)) {
      const where = `role-map.json: ${client}/${roleId}`;
      if (!isObj(raw)) throw new AccessConfigError(`${where} is not an object`);
      const to = String(raw.to);
      if (to !== 'custom' && !PRESET_TARGETS.some((p) => to === `preset:${p}`))
        throw new AccessConfigError(
          `${where}: "${to}" is refused. Allowed: custom, ${PRESET_TARGETS.map((p) => `preset:${p}`).join(', ')}. ` +
            'The Owner role (preset:admin) can never be given to a migrated user, with or without an approver',
        );
      if (to.startsWith('preset:') && !(named(raw.approvedBy) && named(raw.evidence)))
        throw new AccessConfigError(`${where}: a preset target needs approvedBy and evidence`);
      if (raw.allowAdminClass === true && (to !== 'custom' || !named(raw.approvedBy)))
        throw new AccessConfigError(`${where}: allowAdminClass needs a custom role and approvedBy`);
      roles[client][roleId] = {
        to: to as RoleMapEntry['to'],
        approvedBy: raw.approvedBy as string | undefined,
        evidence: raw.evidence as string | undefined,
        allowAdminClass: raw.allowAdminClass === true,
      };
    }
  }
  return {
    permissionMap: {
      version: 1,
      entries,
      candidates: (permissionMap.candidates as PermissionCandidate[] | undefined) ?? [],
    },
    roleMap: roles,
  };
}

export function loadAccessConfig(dir: string = __dirname): AccessConfig {
  const read = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
  return parseAccessConfig(read('permission-map.json'), read('role-map.json'));
}

/** The entry for a Waboo role under any of its keys (_id hex or string id). */
export function roleEntry(
  cfg: AccessConfig,
  client: string,
  keys: string[],
): RoleMapEntry | undefined {
  const m = cfg.roleMap[client];
  if (!m) return undefined;
  for (const k of keys) if (Object.hasOwn(m, k)) return m[k];
  return undefined;
}
