import type { AccessConfig } from './config';
import type { CatalogueRow } from '../extract/catalogue';
import { MODULE_CEILING } from './module-ceiling';

/**
 * The module ceiling of a migrated workspace: a product module the Waboo workspace had no permission in is closed for the preset roles,
 * so the menu, the screens and the API show only what the old workspace had. See access/module-ceiling.ts.
 */
export interface ModuleCeiling {
  modules: Record<string, string[]>;
}

export function loadModuleCeiling(): ModuleCeiling {
  for (const [name, prefixes] of Object.entries(MODULE_CEILING))
    if (prefixes.some((p) => !p.endsWith('.')))
      throw new Error(`module-ceiling.ts: module ${name} must be a list of key prefixes ending in a dot`);
  return { modules: MODULE_CEILING };
}

/** Every crm-platform key a Waboo permission maps to, over all its actions. */
function mappedKeys(entry: AccessConfig['permissionMap']['entries'][string]): string[] {
  return [...(entry.create ?? []), ...(entry.read ?? []), ...(entry.update ?? []), ...(entry.delete ?? []), ...(entry.use ?? [])];
}

/**
 * The crm-platform keys the Waboo workspace had: the REVIEWED map applied to every Waboo permission a live role of the workspace has
 * accessible (the catalogue alone is not enough: it lists what the platform offers, not what this workspace's roles hold). Pure.
 */
export function oldWorkspaceKeys(rows: CatalogueRow[], map: AccessConfig['permissionMap']): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.rolesWithAccess <= 0) continue;
    const e = [r.id, r.name].map((k) => (k && Object.hasOwn(map.entries, k) ? map.entries[k] : undefined)).find(Boolean);
    if (!e || e.status !== 'REVIEWED' || !e.reviewedBy) continue;
    for (const k of mappedKeys(e)) out.add(k);
  }
  return out;
}

/**
 * The target keys to close: every key of a module in which the old workspace held no key at all. `targetKeys` is the permission_defs of
 * the target. Pure. Returns the closed module names too, for the log.
 */
/**
 * Modules a Waboo workspace never gets, whatever its roles held: Waboo sells WhatsApp, not the website chat, so a migrated workspace has no
 * website-chat permission even when a Waboo bot permission maps across the website part too.
 */
export const NEVER_KEPT: readonly string[] = ['website-chat'];

export function closedKeys(
  ceiling: ModuleCeiling,
  oldKeys: ReadonlySet<string>,
  targetKeys: readonly string[],
): { keys: string[]; closed: string[]; kept: string[] } {
  const keys = new Set<string>();
  const closed: string[] = [];
  const kept: string[] = [];
  for (const [name, prefixes] of Object.entries(ceiling.modules)) {
    const had = !NEVER_KEPT.includes(name) && [...oldKeys].some((k) => prefixes.some((p) => k.startsWith(p)));
    if (had) {
      kept.push(name);
      continue;
    }
    closed.push(name);
    for (const k of targetKeys) if (prefixes.some((p) => k.startsWith(p))) keys.add(k);
  }
  return { keys: [...keys].sort(), closed, kept };
}
