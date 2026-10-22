'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, EmptyState, cn } from '@crm/ui';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import { useSettingsTiles } from '@/features/settings-hub/settings-context';
import { SettingsIcon } from '@/features/settings-hub/settings-icons';
import { toolTilesFor, type ToolTab } from '../lib/tools';
import { CARD_FRAME, CARD_GRID, CARD_ICON_BOX, LINK_BUTTON } from './ui';

/** One developer tool as a card that matches the app cards: icon box, name, one line of help and the one thing to do next. */
function ToolCard({ tile }: { tile: ResolvedSettingsTile }) {
  const t = useTranslations();
  const tm = useTranslations('marketplace');
  const label = t(tile.labelKey);
  const soon = tile.comingSoon;
  return (
    <article
      data-testid={`tool-card-${tile.id}`}
      aria-disabled={soon || undefined}
      className={cn(CARD_FRAME, soon && 'opacity-70')}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={CARD_ICON_BOX}>
          <SettingsIcon name={tile.icon} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          {/* h2, not h3: on the Developer tab nothing sits above the cards but the page title (h1). */}
          {/* The title is plain text: the Open button below is the one link to the screen (two links to one place is one tab stop too many). */}
          <h2 className="truncate text-base font-semibold">{label}</h2>
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
 * The developer tool cards (the Developer tab). The tiles come from the Settings registry with the person's gates already applied,
 * so a role or plan without a tool never sees its card (absent, not an empty card); a plan-locked tool shows with an Upgrade badge.
 * `showEmpty` says so when nothing is available. (The built-in connectors of the Integrations tab are not drawn here: they share the
 * listings' grid, see `ConnectorCard`.)
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
      aria-label={t(tab === 'developer' ? 'header.tabs.developer' : 'header.tabs.integration')}
      data-testid={`mkt-tools-${tab}`}
      className={CARD_GRID}
    >
      {tiles.map((tile) => (
        <ToolCard key={tile.id} tile={tile} />
      ))}
    </section>
  );
}
