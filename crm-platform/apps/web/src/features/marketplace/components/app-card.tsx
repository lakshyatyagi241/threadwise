'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { MarketAppCard } from '@crm/contracts';
import { Badge, cn } from '@crm/ui';
import { SettingsIcon } from '@/features/settings-hub/settings-icons';
import type { ConnectorEntry } from '../lib/connectors';
import { cardCta, effectiveLock, installChips, type CtaKind } from '../lib/install-state';
import { mktRoutes } from '../lib/routes';
import { MaturityLine } from './maturity';
import { NeedsPurchaseInstall, PriceText } from './pricing-parts';
import {
  AppLogo,
  CARD_FRAME,
  CARD_ICON_BOX,
  ChipView,
  LINK_BUTTON,
  LINK_BUTTON_PRIMARY,
  LockNotice,
} from './ui';
import { useMarketAccess } from './use-access';

const CTA_STYLE: Record<CtaKind, string> = {
  install: LINK_BUTTON_PRIMARY,
  subscribe: LINK_BUTTON_PRIMARY,
  review: LINK_BUTTON_PRIMARY,
  manage: LINK_BUTTON,
  killed: LINK_BUTTON,
  locked: LINK_BUTTON,
  view: LINK_BUTTON,
};

/** One app in the grid or a shelf: logo, name, tagline, category, badges, state and the one thing the person can do next. */
export function AppCard({ card, className }: { card: MarketAppCard; className?: string }) {
  const t = useTranslations('marketplace.card');
  const access = useMarketAccess();
  const cta = cardCta(card, { install: access.install });
  const lock = effectiveLock(card);
  const chips = card.install ? installChips(card.install) : [];
  return (
    <article data-testid={`app-card-${card.slug}`} className={cn(CARD_FRAME, className)}>
      <div className="flex items-start gap-3">
        <AppLogo name={card.name} logo={card.logo} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">
            <Link
              href={mktRoutes.app(card.slug)}
              className="block truncate py-0.5 hover:underline focus-visible:underline"
            >
              {card.name}
            </Link>
          </h3>
          <p className="truncate text-xs text-muted-foreground">{card.category.name}</p>
        </div>
        {card.firstParty && <Badge tone="neutral">{t('firstParty')}</Badge>}
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{card.tagline}</p>
      <MaturityLine source={card} />
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <li>
          <PriceText pricing={card.pricing} />
        </li>
        {card.installCount > 0 && <li>{t('installs', { count: card.installCount })}</li>}
        <li>{t('version', { version: card.version })}</li>
      </ul>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <ChipView key={c.key} chip={c} />
          ))}
        </div>
      )}
      {lock && <LockNotice lock={lock} compact />}
      <div className="mt-auto flex min-w-0 flex-wrap items-start gap-2 pt-1">
        <Link href={cta.href} className={cn(CTA_STYLE[cta.kind], 'w-full sm:w-auto')}>
          {t(`cta.${cta.kind}`)}
          <span className="sr-only"> — {card.name}</span>
        </Link>
        {cta.needsPurchase && (
          <NeedsPurchaseInstall id={`mkt-needs-${card.slug}`} label={t('cta.install')} />
        )}
      </div>
    </article>
  );
}

/**
 * One built-in connector in the same grid as the listings (Integrations tab): the same frame, icon box, title, category line, two-line
 * description, meta line, status badge and one button as `AppCard`, so a person cannot tell two kinds of card apart by their layout.
 * The status says only what is known: Connected, Not connected, Upgrade (the plan lacks it) or Soon; a connection that could not be read
 * shows no status at all. The title and the button are the one link pair to the connector's own screen.
 */
export function ConnectorCard({
  entry,
  categoryName,
  className,
}: {
  entry: ConnectorEntry;
  categoryName: string | null;
  className?: string;
}) {
  const t = useTranslations('marketplace.connector');
  const status = entry.comingSoon
    ? ({ key: 'soon', tone: 'neutral' } as const)
    : entry.locked
      ? ({ key: 'upgrade', tone: 'warning' } as const)
      : entry.status === 'connected'
        ? ({ key: 'connected', tone: 'success' } as const)
        : entry.status === 'not_connected'
          ? ({ key: 'notConnected', tone: 'neutral' } as const)
          : null;
  const cta =
    entry.locked || entry.status === 'unknown'
      ? 'open'
      : entry.status === 'connected'
        ? 'manage'
        : 'connect';
  return (
    <article
      data-testid={`connector-card-${entry.id}`}
      data-status={entry.comingSoon ? 'soon' : entry.locked ? 'upgrade' : entry.status}
      aria-disabled={entry.comingSoon || undefined}
      className={cn(CARD_FRAME, entry.comingSoon && 'opacity-70', className)}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={CARD_ICON_BOX}>
          <SettingsIcon name={entry.icon} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">
            {entry.comingSoon ? (
              entry.name
            ) : (
              <Link
                href={entry.href}
                className="block truncate py-0.5 hover:underline focus-visible:underline"
              >
                {entry.name}
              </Link>
            )}
          </h3>
          {categoryName && <p className="truncate text-xs text-muted-foreground">{categoryName}</p>}
        </div>
        <Badge tone="neutral">{t('builtIn')}</Badge>
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{entry.description}</p>
      {status && (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={status.tone} data-testid="connector-status">
            {t(`status.${status.key}`)}
          </Badge>
        </div>
      )}
      {!entry.comingSoon && (
        <div className="mt-auto flex min-w-0 flex-wrap items-start gap-2 pt-1">
          <Link
            href={entry.href}
            className={cn(
              cta === 'connect' ? LINK_BUTTON_PRIMARY : LINK_BUTTON,
              'w-full sm:w-auto',
            )}
          >
            {t(`cta.${cta}`)}
            <span className="sr-only"> — {entry.name}</span>
          </Link>
        </div>
      )}
    </article>
  );
}
