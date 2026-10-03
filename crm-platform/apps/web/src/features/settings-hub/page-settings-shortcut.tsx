'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { Popover } from '@crm/ui';
import { tilesForScreen } from '@/features/_registry/settings-resolve';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import { NavIcon } from '@/components/shell/nav-icons';
import { SettingsIcon } from './settings-icons';

/**
 * The gear in the top bar that offers the settings behind the screen you are on: Contact properties and stages on the
 * contacts list, Pipelines and stages on the deals board, Tax rates on invoices. A tile declares the screens it belongs to
 * (`shortcutFrom`); the tiles arrive already filtered by the person's permissions, so a role that cannot open a setting never
 * sees its gear. The tooltip and the panel carry the tile's own help line, so the person learns what is behind it before
 * they click. Nothing renders when the screen has no shortcut.
 */
export function PageSettingsShortcut({ tiles }: { tiles: readonly ResolvedSettingsTile[] }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const here = useMemo(() => tilesForScreen(tiles, pathname), [tiles, pathname]);
  if (here.length === 0) return null;

  const label = t('shell.pageSettings.label');
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={`${label}: ${here.map((tile) => t(tile.labelKey)).join(', ')}`}
        data-testid="page-settings-shortcut"
        className="flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        <NavIcon name="gear" className="size-5" />
      </button>
      <Popover
        open={open}
        onClose={close}
        label={label}
        className="fixed end-2 start-2 top-14 mt-0 w-auto space-y-0 overflow-hidden p-0 sm:absolute sm:start-auto sm:end-0 sm:top-full sm:mt-1 sm:w-80"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{label}</h2>
          <p className="text-xs text-muted-foreground">{t('shell.pageSettings.hint')}</p>
        </div>
        <ul className="divide-y divide-border">
          {here.map((tile) => (
            <li key={tile.id}>
              <Link
                href={tile.href}
                onClick={close}
                className="flex items-start gap-3 px-4 py-3 outline-none transition hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <SettingsIcon
                  name={tile.icon}
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t(tile.labelKey)}</span>
                  {tile.descriptionKey && (
                    <span className="block text-xs text-muted-foreground">
                      {t(tile.descriptionKey)}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}
