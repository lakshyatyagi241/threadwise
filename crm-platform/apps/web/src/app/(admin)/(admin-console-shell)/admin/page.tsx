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
 * The console home: what needs attention now, then one card per hub the operator can open, with a sentence on what is inside.
 * The pages themselves are the hub's tabs, so this is a map of eleven areas, not a second copy of the whole menu. Reference's
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
            className="group rounded-lg border border-border p-4 transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
              <ConsoleIcon name={hub.icon} className="size-4 text-muted-foreground" />
              {tAll(hub.labelKey)}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {tAll(`admin-console-shell.nav.hubNotes.${hub.id}`)}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
