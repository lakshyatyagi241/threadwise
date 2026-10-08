import type { NavContributionsResponse } from '@crm/contracts';
import {
  emptySection,
  type ConsoleEntry,
  type ConsoleGroup,
  type ConsoleLeaf,
} from '@/features/admin-console-shell/console-nav';
import { MODULES_SECTION } from '@/features/admin-console-shell/console-layout';

/** The rail section modules add to: Apps & modules, under its "Modules" heading (WaDesk lists them in its System rail). */
export const MODULE_NAV_GROUP = MODULES_SECTION;
/** Instagram shows as a card on the channel settings hub instead of in the rail (WD-ADD-012). */
export const SKIPPED_KEYS: ReadonlySet<string> = new Set(['instagram']);

/**
 * Appends what active modules contribute to the console rail, after the group's own pages and in manifest order
 * (WaDesk ignores the manifest's `after` key; so do we). An item with no key or href is dropped; the API already
 * made every href app-relative.
 */
export function withModuleLeaves(
  entries: readonly ConsoleEntry[],
  contributions: NavContributionsResponse['admin'] | undefined,
): ConsoleEntry[] {
  const leaves: ConsoleLeaf[] = (contributions ?? [])
    .filter((n) => n.key && n.href && !SKIPPED_KEYS.has(n.key))
    .map((n) => ({
      id: `module-${n.module}-${n.key}`,
      href: n.href.startsWith('/') ? n.href : `/${n.href}`,
      labelKey: '',
      label: n.label || n.key,
    }));
  if (leaves.length === 0) return [...entries];
  const out = entries.map((e) => ('children' in e ? { ...e, children: [...e.children] } : e));
  const group = out.find((e): e is ConsoleGroup => 'children' in e && e.id === MODULE_NAV_GROUP);
  if (group) group.children.push(...leaves);
  else out.push({ ...emptySection(MODULE_NAV_GROUP), children: leaves });
  return out;
}
