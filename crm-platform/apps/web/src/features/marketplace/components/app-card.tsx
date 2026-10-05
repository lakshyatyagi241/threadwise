'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { MarketAppCard } from '@crm/contracts';
import { Badge, cn } from '@crm/ui';
import { cardCta, effectiveLock, installChips, type CtaKind } from '../lib/install-state';
import { mktRoutes } from '../lib/routes';
import { MaturityLine } from './maturity';
import { NeedsPurchaseInstall, PriceText } from './pricing-parts';
import { AppLogo, ChipView, LINK_BUTTON, LINK_BUTTON_PRIMARY, LockNotice } from './ui';
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
    <article
      data-testid={`app-card-${card.slug}`}
      className={cn(
        'flex h-full min-w-0 flex-col gap-3 rounded-md border border-border bg-background p-4',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AppLogo name={card.name} logo={card.logo} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">
            <Link
              href={mktRoutes.app(card.slug)}
              className="hover:underline focus-visible:underline"
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
