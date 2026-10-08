import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  buildConsoleNav,
  CONSOLE_NAV_ITEMS,
  hubHref,
  isGroup,
} from '@/features/admin-console-shell/console-nav';
import { CONSOLE_LAYOUT } from '@/features/admin-console-shell/console-layout';
import { pageVisibleTo } from '@/features/admin-console-shell/console-access';
import { ConsoleIcon } from '@/features/admin-console-shell/console-icons';
import { HomeAttention } from '@/features/admin-console-shell/home-attention';
import { getOperatorSession } from '@/lib/auth/server';

/**
 * The console home: what needs attention now, then one block per area the operator can open, with a sentence on what is inside
 * and how many pages. The pages themselves are the area's left menu, so this is a map of eleven areas, not a second copy of the menu. WaDesk's
 * overview is a KPI dashboard (DASH owns it); the KPI tiles join this page when that lands.
 */
export default async function AdminHome() {
  const t = await getTranslations('admin-console-shell.overview');
  const tAll = await getTranslations();
  const { session } = await getOperatorSession();
  const role = session?.operator.role;
  const hubs = buildConsoleNav(CONSOLE_NAV_ITEMS, CONSOLE_LAYOUT, (id) =>
    role ? pageVisibleTo(role, id) : true,
  )
    .filter(isGroup)
    .filter((hub) => CONSOLE_LAYOUT.some((l) => l.id === hub.id));

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('note')}</p>
      </header>
      <HomeAttention />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {hubs.map((hub) => (
          <Link
            key={hub.id}
            href={hubHref(hub)}
            data-testid={`home-hub-${hub.id}`}
            className="flex flex-col gap-1.5 rounded-xl border border-border p-4 transition hover:border-foreground/30 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span
              aria-hidden="true"
              className="mb-1 flex size-9 items-center justify-center rounded-[10px] bg-primary/10 text-primary"
            >
              <ConsoleIcon name={hub.icon} className="size-5" />
            </span>
            <h2 className="text-sm font-medium">{tAll(hub.labelKey)}</h2>
            <p className="text-sm text-muted-foreground">
              {tAll(`admin-console-shell.nav.hubNotes.${hub.id}`)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('pages', { count: hub.children.length })}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
