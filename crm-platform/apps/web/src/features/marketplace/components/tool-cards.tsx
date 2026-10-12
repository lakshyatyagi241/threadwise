'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, EmptyState, cn } from '@crm/ui';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import { useSettingsTiles } from '@/features/settings-hub/settings-context';
import { SettingsIcon } from '@/features/settings-hub/settings-icons';
import { toolTilesFor, type ToolTab } from '../lib/tools';
import { LINK_BUTTON } from './ui';

/** One workspace tool as a card that matches the app cards: icon box, name, one line of help and the one thing to do next. */
function ToolCard({ tile }: { tile: ResolvedSettingsTile }) {
  const t = useTranslations();
  const tm = useTranslations('marketplace');
  const label = t(tile.labelKey);
  const soon = tile.comingSoon;
  return (
    <article
      data-testid={`tool-card-${tile.id}`}
      aria-disabled={soon || undefined}
      className={cn(
        'flex h-full min-w-0 flex-col gap-3 rounded-md border border-border bg-background p-4',
        soon && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground/80"
        >
          <SettingsIcon name={tile.icon} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">
            {soon ? (
              label
            ) : (
              <Link
                href={tile.href}
                className="block truncate py-0.5 hover:underline focus-visible:underline"
              >
                {label}
              </Link>
            )}
          </h3>
        </div>
        {soon ? (
          <Badge tone="neutral">{tm('tools.soon')}</Badge>
        ) : tile.locked ? (
          <Badge tone="warning">{tm('tools.upgrade')}</Badge>
        ) : null}
      </div>
      {tile.descriptionKey && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{t(tile.descriptionKey)}</p>
      )}
      {!soon && (
        <div className="mt-auto flex min-w-0 flex-wrap items-start gap-2 pt-1">
          <Link href={tile.href} className={cn(LINK_BUTTON, 'w-full sm:w-auto')}>
            {tm('tools.open')}
            <span className="sr-only"> — {label}</span>
          </Link>
        </div>
      )}
    </article>
  );
}

/**
 * The cards of one tab. The tiles come from the Settings registry with the person's gates already applied, so a role or plan
 * without a tool never sees its card. On the Add-ons tab, `showEmpty` says so when nothing is available.
 */
export function ToolCards({ tab, showEmpty = false }: { tab: ToolTab; showEmpty?: boolean }) {
  const t = useTranslations('marketplace');
  const tiles = toolTilesFor(tab, useSettingsTiles());
  if (tiles.length === 0) {
    return showEmpty ? (
      <EmptyState title={t('tools.empty.title')} message={t('tools.empty.message')} />
    ) : null;
  }
  return (
    <section
      aria-labelledby={`mkt-tools-${tab}-title`}
      data-testid={`mkt-tools-${tab}`}
      className="space-y-3"
    >
      {/* The cards are h3: this keeps the heading levels in order (the page title is the h1). */}
      <h2 id={`mkt-tools-${tab}-title`} className="sr-only">
        {t(tab === 'addons' ? 'header.tabs.addon' : 'header.tabs.integration')}
      </h2>
      <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <ToolCard key={tile.id} tile={tile} />
        ))}
      </div>
    </section>
  );
}
