import { matchesHref } from './nav-model';
import { isSettingsSection } from '@/features/_registry/settings-types';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';

/**
 * The message key that names the screen at `pathname`, from the same registries that draw the menu and the Settings tiles, so a new
 * page gets its tab title by being registered and nothing else. The longest matching address wins (`/appointments/types` is a
 * tile, `/appointments` a menu entry); on a tie the menu entry wins. A Settings section page (`/settings/people`) is named by
 * its section. Undefined = no registered screen (the caller falls back to the page's own heading).
 */
export function pageLabelKey(
  pathname: string,
  nav: readonly ResolvedNavItem[],
  tiles: readonly ResolvedSettingsTile[],
): string | undefined {
  let best: { key: string; len: number } | undefined;
  for (const n of nav) {
    if (n.comingSoon || !matchesHref(pathname, n.href)) continue;
    if (!best || n.href.length > best.len) best = { key: n.labelKey, len: n.href.length };
  }
  for (const t of tiles) {
    if (t.comingSoon || !matchesHref(pathname, t.href)) continue;
    if (!best || t.href.length > best.len) best = { key: t.labelKey, len: t.href.length };
  }
  const section = /^\/settings\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (section && isSettingsSection(section) && (!best || best.len <= '/settings'.length)) {
    return `settings.sections.${section}.title`;
  }
  return best?.key;
}

export interface TitleInput {
  /** The screen's name, or '' when none is registered. */
  label: string;
  /** The workspace the person is in. */
  workspace: string;
  /** The product name; a page that set its own title through the site template ends with ` - <brand>`. */
  brand: string;
  /** What the server rendered into `<title>` (the page's own title, or the site default), or null when not known. */
  serverTitle: string | null;
}

/**
 * `<Page> | <Workspace name>`. A page that set its own title (a specific one such as a contact's name, rendered through the site
 * template `%s - <brand>`) keeps its own words; every other page is named by its registry label. Returns null when nothing
 * names the page: the tab keeps what the server rendered.
 */
export function documentTitle({ label, workspace, brand, serverTitle }: TitleInput): string | null {
  const suffix = ` - ${brand}`;
  const own =
    serverTitle && brand && serverTitle.endsWith(suffix)
      ? serverTitle.slice(0, -suffix.length).trim()
      : '';
  const page = own || label.trim();
  if (!page) return null;
  return workspace.trim() ? `${page} | ${workspace.trim()}` : `${page} | ${brand}`;
}
