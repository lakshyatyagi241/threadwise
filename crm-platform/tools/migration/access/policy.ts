import { bool, str } from '../util';
import { isAdminClassKey } from './admin-class';
import type { AccessConfig, PermissionMapEntry, Scope } from './config';

export interface KeyDef {
  category: string;
  supportsScope: boolean;
  planFeature: string | null;
  appSlug: string | null;
}
export interface Grant {
  key: string;
  scope: Scope;
}
export interface PolicyResult {
  grants: Grant[];
  /** Waboo permissions that are accessible but have no REVIEWED map entry (they grant nothing). */
  unmapped: string[];
  /** Subset of `unmapped` that has an entry which is not REVIEWED yet. */
  unreviewed: string[];
  unknownKeys: string[];
  planLocked: Array<{ key: string; feature: string }>;
  adminWithheld: string[];
}

const CRUD = ['create', 'read', 'update', 'delete'] as const;

/** One Waboo CRUD value as a scope: true / global_access = all, restricted_access = own, anything else (none, false, absent) = nothing. */
export function crudScope(v: unknown): Scope | null {
  if (v === true) return 'all';
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === 'global_access' || s === 'true' || s === 'all') return 'all';
  if (s === 'restricted_access' || s === 'own') return 'own';
  return null;
}
const STANDARD = new Set(['id', 'name', 'is_accessible', 'has_crud', ...CRUD]);
const RANK: Record<Scope, number> = { own: 1, team: 2, all: 3 };

/**
 * Waboo permission_config -> grants for one role. Pure. FAIL CLOSED: a permission without a REVIEWED map entry grants nothing; a
 * not-accessible permission adds nothing (and never a deny); a key the target does not know, an admin-class key (unless approved),
 * a key outside the org's plan, and a key that belongs to an app that is not installed are all dropped and reported.
 */
export function mapPermissions(a: {
  permissionConfig: unknown;
  map: AccessConfig['permissionMap'];
  defs: Map<string, KeyDef>;
  featureOpen: (feature: string) => boolean;
  allowAdminClass: boolean;
}): PolicyResult {
  const best = new Map<string, Scope>();
  const unmapped = new Set<string>();
  const unreviewed = new Set<string>();
  const unknown = new Set<string>();
  const admin = new Set<string>();
  const locked = new Map<string, string>();

  const apply = (
    ident: string,
    entry: PermissionMapEntry | undefined,
    keys: string[],
    scopeOverride?: Scope,
  ): void => {
    if (!entry || entry.status !== 'REVIEWED' || !entry.reviewedBy) {
      unmapped.add(ident);
      if (entry) unreviewed.add(ident);
      return;
    }
    if (keys.length === 0) {
      unmapped.add(ident); // mapped to nothing = NONE
      return;
    }
    for (const key of keys) {
      const def = a.defs.get(key);
      if (!def) {
        unknown.add(key);
        continue;
      }
      if (isAdminClassKey(key, def.category) && !a.allowAdminClass) {
        admin.add(key);
        continue;
      }
      if (def.planFeature && !a.featureOpen(def.planFeature)) {
        locked.set(key, def.planFeature);
        continue;
      }
      if (def.appSlug) {
        locked.set(key, `app:${def.appSlug}`);
        continue;
      }
      const scope: Scope = def.supportsScope ? (scopeOverride ?? entry.scope ?? 'all') : 'all';
      const had = best.get(key);
      if (!had || RANK[scope] > RANK[had]) best.set(key, scope);
    }
  };

  const own = (id: string | null): PermissionMapEntry | undefined =>
    id && Object.hasOwn(a.map.entries, id) ? a.map.entries[id] : undefined;
  const list = Array.isArray(a.permissionConfig) ? a.permissionConfig : [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const e = raw as Record<string, unknown>;
    const id = str(e.id);
    const name = str(e.name);
    if (id || name) {
      if (!bool(e.is_accessible)) continue;
      const entry = own(id) ?? own(name);
      if (bool(e.has_crud)) {
        // Waboo writes create as a boolean and read/update/delete as a word: global_access (everything), restricted_access (own
        // records) or none. Waboo's own words decide the scope per role; the map only says which keys an action means.
        for (const act of CRUD) {
          const sc = crudScope(e[act]);
          if (sc) apply((id ?? name)!, entry, entry?.[act] ?? [], sc);
        }
        if (!CRUD.some((act) => crudScope(e[act]))) apply((id ?? name)!, entry, []);
      } else apply((id ?? name)!, entry, entry?.use ?? []);
    } else {
      // pseudo entries such as { agent_summary: true }: the key itself is the identifier
      for (const [k, v] of Object.entries(e)) {
        if (STANDARD.has(k) || !bool(v)) continue;
        const entry = own(k);
        apply(k, entry, entry?.use ?? []);
      }
    }
  }
  return {
    grants: [...best]
      .map(([key, scope]) => ({ key, scope }))
      .sort((x, y) => x.key.localeCompare(y.key)),
    unmapped: [...unmapped].sort(),
    unreviewed: [...unreviewed].sort(),
    unknownKeys: [...unknown].sort(),
    adminWithheld: [...admin].sort(),
    planLocked: [...locked]
      .map(([key, feature]) => ({ key, feature }))
      .sort((x, y) => x.key.localeCompare(y.key)),
  };
}
