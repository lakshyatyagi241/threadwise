import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { OPERATOR_NAV } from '@/features/auth-registration-security/platform/operator-nav';
import {
  buildConsoleNav,
  isGroup,
  type ConsoleLeaf,
} from '@/features/admin-console-shell/console-nav';

/**
 * The console landing page: one card per area the menu offers. WaDesk's overview is a KPI
 * dashboard (DASH owns it); until that lands this keeps `/admin` useful as a map of the console.
 */
export default async function AdminHome() {
  const t = await getTranslations('admin-console-shell.overview');
  const tAll = await getTranslations();
  const areas = buildConsoleNav(OPERATOR_NAV).filter(isGroup);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('note')}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {areas.map((area) => (
          <section
            key={area.id}
            aria-labelledby={`area-${area.id}`}
            className="rounded-lg border border-border p-4"
          >
            <h2 id={`area-${area.id}`} className="text-sm font-semibold uppercase tracking-wide">
              {tAll(area.labelKey)}
            </h2>
            <ul className="mt-3 space-y-1">
              {area.children.map((leaf: ConsoleLeaf) => (
                <li key={leaf.id}>
                  <Link
                    href={leaf.href}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span>{tAll(leaf.labelKey)}</span>
                    <span className="text-xs text-muted-foreground">{t('open')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
