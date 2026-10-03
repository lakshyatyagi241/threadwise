'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@crm/ui';
import { NavIcon } from '@/components/shell/nav-icons';
import { useQuickAccess } from './api';
import { QuickAccessModal } from './quick-access-modal';

const NS = 'admin-console-shell.quickAccess';

/**
 * The dashboard's quick access section (TW-ASHELL-022): up to ten tiles, three, five or ten to a row by width, and an Edit
 * button that opens the shared editor. The dashboard domain places it; the shell owns what it shows.
 */
export function QuickAccessTiles() {
  const t = useTranslations(NS);
  const q = useQuickAccess();
  const [editing, setEditing] = useState(false);
  const tiles = q.data?.tiles ?? [];
  return (
    <section data-tour="quick-access" aria-labelledby="qa-title" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="qa-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          {t('edit')}
        </Button>
      </div>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 xl:grid-cols-10">
        {tiles.map((tile) => {
          const external = /^https?:\/\//i.test(tile.url);
          const body = (
            <>
              <NavIcon name={tile.icon} className="size-5 text-primary" />
              <span className="line-clamp-2 text-xs font-medium">
                {tile.custom ? tile.label : t(`catalog.${tile.key}.label`)}
              </span>
            </>
          );
          const cls =
            'flex h-full flex-col items-center gap-2 rounded-xl border border-border p-3 text-center outline-none transition hover:border-primary focus-visible:ring-2 focus-visible:ring-primary';
          return (
            <li key={tile.key ?? tile.url}>
              {external ? (
                <a
                  href={tile.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={tile.desc}
                  className={cls}
                >
                  {body}
                </a>
              ) : (
                <Link href={tile.url} title={tile.desc} className={cls}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <QuickAccessModal open={editing} tiles={tiles} onClose={() => setEditing(false)} />
    </section>
  );
}
