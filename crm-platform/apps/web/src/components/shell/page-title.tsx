'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { splitTitleBadge } from '@/lib/tab-title';
import { useBrandName } from './brand';
import { documentTitle, pageLabelKey } from './page-title-model';

/**
 * The browser tab title of every signed-in page, `<Page> | <Workspace name>`, set in this one place from the menu and Settings
 * registries (see `pageLabelKey`), so a page added to the registry is named without a metadata export of its own. A page that
 * renders its own specific title keeps it (`documentTitle`). The server renders the site title first; this replaces it after
 * hydration and again whenever the server title changes (a streamed page title arriving late must not undo it).
 */
export function PageTitle({
  nav,
  tiles,
}: {
  nav: readonly ResolvedNavItem[];
  tiles: readonly ResolvedSettingsTile[];
}) {
  const pathname = usePathname();
  const t = useTranslations();
  const brand = useBrandName();
  const workspace = useSession().org.name;
  const key = pageLabelKey(pathname, nav, tiles);
  const registered = key ? t(key) : '';

  useEffect(() => {
    let mine: string | null = null;
    let server: string | null = null;
    const apply = () => {
      const label = registered || document.querySelector('main h1')?.textContent?.trim() || '';
      // The live notifications own the `(3) ` unread badge in front of the title: name the page, keep the badge as it is. Writing
      // the title without it makes that watcher put it back, which makes this one rewrite it, and so on without end.
      const { badge, base } = splitTitleBadge(document.title);
      if (base !== mine) server = base;
      const next = documentTitle({ label, workspace, brand, serverTitle: server });
      if (!next) return;
      mine = next;
      if (badge + next !== document.title) document.title = badge + next;
    };
    // The route just changed: whatever is in the tab now was rendered by the server for this page (or is our previous title).
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    // A screen no registry names (a detail page, the not-found page) is titled by its own heading once it has drawn.
    const late = registered ? undefined : window.setTimeout(apply, 250);
    return () => {
      observer.disconnect();
      if (late) window.clearTimeout(late);
    };
  }, [registered, workspace, brand, pathname]);

  return null;
}
