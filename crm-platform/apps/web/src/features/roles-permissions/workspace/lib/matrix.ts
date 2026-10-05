import type { PermissionDefResponse, RecordScope, RoleGrant } from '@crm/contracts';

/** A role's grants while editing: permission key -> effect and scope. A key that is absent is not granted. */
export type GrantDraft = ReadonlyMap<
  string,
  { effect: 'allow' | 'deny'; recordScope: RecordScope }
>;
export type TriState = 'none' | 'some' | 'all';

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface CategoryGroup {
  category: string;
  items: PermissionDefResponse[];
  keys: string[];
}

/** Categories alphabetical, entries by label inside. */
export function groupByCategory(defs: readonly PermissionDefResponse[]): CategoryGroup[] {
  const map = new Map<string, PermissionDefResponse[]>();
  for (const d of defs) {
    const list = map.get(d.category);
    if (list) list.push(d);
    else map.set(d.category, [d]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([category, list]) => {
      const items = [...list].sort((x, y) => byText(x.label, y.label) || byText(x.key, y.key));
      return { category, items, keys: items.map((i) => i.key) };
    });
}

/** Search over label, key and category (case-insensitive); an empty query keeps everything. */
export function filterDefs(
  defs: readonly PermissionDefResponse[],
  query: string,
): PermissionDefResponse[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...defs];
  return defs.filter(
    (d) =>
      d.label.toLowerCase().includes(q) ||
      d.key.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q),
  );
}

export function draftFromGrants(grants: readonly RoleGrant[]): GrantDraft {
  return new Map(
    grants.map((g) => [g.permissionKey, { effect: g.effect, recordScope: g.recordScope }]),
  );
}

/** Sorted array for the request body so equal drafts serialise equally. Scope is `all` for keys without scope support. */
export function grantsFromDraft(
  draft: GrantDraft,
  defs: readonly Pick<PermissionDefResponse, 'key' | 'supportsScope'>[],
): RoleGrant[] {
  const scoped = new Set(defs.filter((d) => d.supportsScope).map((d) => d.key));
  return [...draft.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([permissionKey, g]) => ({
      permissionKey,
      effect: g.effect,
      recordScope: scoped.has(permissionKey) ? g.recordScope : 'all',
    }));
}

export function toggleKey(draft: GrantDraft, key: string): GrantDraft {
  const next = new Map(draft);
  if (next.has(key)) next.delete(key);
  else next.set(key, { effect: 'allow', recordScope: 'all' });
  return next;
}

export function setEffect(draft: GrantDraft, key: string, effect: 'allow' | 'deny'): GrantDraft {
  const cur = draft.get(key);
  if (!cur || cur.effect === effect) return draft;
  return new Map(draft).set(key, { ...cur, effect });
}

export function setScope(draft: GrantDraft, key: string, recordScope: RecordScope): GrantDraft {
  const cur = draft.get(key);
  if (!cur || cur.recordScope === recordScope) return draft;
  return new Map(draft).set(key, { ...cur, recordScope });
}

/** Ticks (as allow/all) or clears every key of a category; keys already granted keep their effect and scope when ticked. */
export function setMany(draft: GrantDraft, keys: readonly string[], on: boolean): GrantDraft {
  const next = new Map(draft);
  for (const k of keys) {
    if (!on) next.delete(k);
    else if (!next.has(k)) next.set(k, { effect: 'allow', recordScope: 'all' });
  }
  return next;
}

export function triState(draft: GrantDraft, keys: readonly string[]): TriState {
  if (keys.length === 0) return 'none';
  const hit = keys.filter((k) => draft.has(k)).length;
  return hit === 0 ? 'none' : hit === keys.length ? 'all' : 'some';
}

export function countSelected(draft: GrantDraft, keys?: readonly string[]): number {
  return keys ? keys.filter((k) => draft.has(k)).length : draft.size;
}

export const countDenied = (draft: GrantDraft): number =>
  [...draft.values()].filter((g) => g.effect === 'deny').length;

/** "Start from role": another role's grants, limited to keys the catalogue still has, replace the draft. */
export function applyTemplate(
  catalogueKeys: readonly string[],
  template: readonly RoleGrant[] | null,
): GrantDraft {
  if (!template) return new Map();
  const known = new Set(catalogueKeys);
  return draftFromGrants(template.filter((g) => known.has(g.permissionKey)));
}

export function sameDraft(a: GrantDraft, b: GrantDraft): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const o = b.get(k);
    if (!o || o.effect !== v.effect || o.recordScope !== v.recordScope) return false;
  }
  return true;
}
