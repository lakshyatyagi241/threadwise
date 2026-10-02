import { groupPermissions, type ModuleGroup } from './matrix';

/**
 * WaDesk's search box and "All modules" select do nothing; here they filter the catalogue in the browser.
 * The search matches any part of the name, case-insensitively; an empty module means all of them.
 */
export function filterPermissions<T extends { name: string; module: string }>(
  permissions: readonly T[],
  search: string,
  module: string,
): Array<ModuleGroup<T>> {
  const needle = search.trim().toLowerCase();
  const kept = permissions.filter(
    (p) =>
      (module === '' || p.module === module) &&
      (needle === '' || p.name.toLowerCase().includes(needle)),
  );
  return groupPermissions(kept);
}
