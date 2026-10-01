import { SECURITY_TABS, type SecurityTab } from './policy-draft';

export const TAB_STORAGE_KEY = 'crm:operator:security-tab';

/** WaDesk named the Danger zone panel `incidents`; old bookmarks keep working. */
const ALIAS: Record<string, SecurityTab> = { incidents: 'danger' };

export function asTab(value: string | null | undefined): SecurityTab | null {
  if (!value) return null;
  const v = value.replace(/^#/, '');
  if ((SECURITY_TABS as readonly string[]).includes(v)) return v as SecurityTab;
  return ALIAS[v] ?? null;
}

/** The URL hash wins (a shared link), then the tab this browser tab last used, then Summary. */
export function resolveInitialTab(hash: string, stored: string | null): SecurityTab {
  return asTab(hash) ?? asTab(stored) ?? 'summary';
}
