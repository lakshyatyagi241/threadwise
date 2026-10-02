'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { tileForPath } from '@/features/_registry/settings-resolve';
import { useSettingsTiles } from './settings-context';

/**
 * "Back to Settings" breadcrumb, shown above any screen a Settings tile points at (Tax rates, Contact stages, Add-ons...),
 * so a moved screen is never a dead end now that it has no menu entry. It needs no edit in the screen: the shell renders it
 * from the same tiles the Settings pages use. Nothing is shown on the Settings pages themselves or on other screens.
 */
export function SettingsBack() {
  const t = useTranslations();
  const pathname = usePathname();
  const tiles = useSettingsTiles();
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return null;
  const tile = tileForPath(tiles, pathname);
  if (!tile) return null;

  const link =
    'rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-primary';
  return (
    <nav aria-label={t('settings.breadcrumb')} className="mb-4">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <li>
          <Link href="/settings" className={`inline-flex items-center gap-1 font-medium ${link}`}>
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="size-4 rtl:rotate-180"
            >
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
            {t('settings.backToSettings')}
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <Link href={`/settings/${tile.section}`} className={link}>
            {t(`settings.sections.${tile.section}.title`)}
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="font-medium text-foreground">
          {t(tile.labelKey)}
        </li>
      </ol>
    </nav>
  );
}
