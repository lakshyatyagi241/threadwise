/** One module card: the permissions that share the text before their first dot. */
export interface ModuleGroup<T extends { name: string } = { name: string }> {
  module: string;
  items: T[];
  names: string[];
}

export type TriState = 'none' | 'some' | 'all';

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** "campaigns" -> "Campaigns": Reference capitalises the heading with CSS, we do it in text so it also reads right aloud. */
export function capitalise(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** Modules alphabetical, names alphabetical inside a module, exactly like Reference's `groupBy` over a name-ordered list. */
export function groupPermissions<T extends { name: string; module: string }>(
  permissions: readonly T[],
): Array<ModuleGroup<T>> {
  const byModule = new Map<string, T[]>();
  for (const p of permissions) {
    const list = byModule.get(p.module);
    if (list) list.push(p);
    else byModule.set(p.module, [p]);
  }
  return [...byModule.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([module, list]) => {
      const items = [...list].sort((x, y) => byText(x.name, y.name));
      return { module, items, names: items.map((i) => i.name) };
    });
}

/** `all` when every name is ticked, `some` when at least one is, otherwise `none`; an empty list is `none`. */
export function triState(selected: ReadonlySet<string>, names: readonly string[]): TriState {
  if (names.length === 0) return 'none';
  let hit = 0;
  for (const n of names) if (selected.has(n)) hit += 1;
  return hit === 0 ? 'none' : hit === names.length ? 'all' : 'some';
}

/**
 * The selection with every one of `names` ticked or unticked. A tri-state box in the `some` state is unchecked, so a
 * click ticks them all. `keep` are names that stay ticked whatever happens (a locked role's grants).
 */
export function setMany(
  selected: ReadonlySet<string>,
  names: readonly string[],
  on: boolean,
  keep: ReadonlySet<string> = new Set(),
): Set<string> {
  const next = new Set(selected);
  for (const n of names) {
    if (on) next.add(n);
    else if (!keep.has(n)) next.delete(n);
  }
  return next;
}

export function toggleOne(selected: ReadonlySet<string>, name: string): Set<string> {
  const next = new Set(selected);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  return next;
}

/**
 * "Start from template": the template role's permissions, limited to names the catalogue still has, replace the
 * selection; Blank (`null`) clears it. Names the catalogue lacks are dropped, the server would refuse them.
 */
export function applyTemplate(
  catalogue: readonly string[],
  template: readonly string[] | null,
): Set<string> {
  if (!template) return new Set();
  const known = new Set(catalogue);
  return new Set(template.filter((n) => known.has(n)));
}

/** Sorted array for the request body, so two equal selections serialise equally. */
export const selectionToList = (selected: ReadonlySet<string>): string[] =>
  [...selected].sort(byText);

/** True when two selections hold the same names. */
export function sameSelection(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const n of a) if (!b.has(n)) return false;
  return true;
}
