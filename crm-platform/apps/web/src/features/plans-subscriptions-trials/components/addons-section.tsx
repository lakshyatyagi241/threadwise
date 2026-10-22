'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { AddonCard } from '@crm/contracts';
import { Badge } from '@crm/ui';
import { fetchAddons } from '../api';
import { checkoutPath, formatMoney } from '../lib/format';

const NS = 'plans-subscriptions-trials.plans.addons';

/**
 * Add-ons (TW-PLAN-011): packs bought on top of an active paid plan. The catalogue and the eligibility rule belong to the add-ons domain
 * (`GET /addons`); a workspace without an active paid plan gets an empty catalogue and sees nothing here. Buying goes through the same checkout.
 */
export function AddonsSection({ canManage }: { canManage: boolean }) {
  const t = useTranslations(NS);
  const locale = useLocale();
  const timeZone = useTimeZone();
  const titleId = useId();
  const q = useQuery({
    queryKey: ['billing', 'addons'],
    queryFn: ({ signal }) => fetchAddons(signal),
    staleTime: 0,
  });
  if (
    !q.data ||
    (!q.data.eligible && q.data.owned.length === 0) ||
    (q.data.catalog.length === 0 && q.data.owned.length === 0)
  )
    return null;

  return (
    <section aria-labelledby={titleId} className="space-y-3" data-testid="addons-section">
      <h2 id={titleId} className="text-lg font-semibold">
        {t('title')}
      </h2>
      {q.data.owned.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-sm" aria-label={t('owned')}>
          {q.data.owned.map((o) => (
            <li key={o.id}>
              <Badge tone="success">
                {o.name}
                {o.endsAt &&
                  ` · ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(new Date(o.endsAt))}`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {q.data.catalog.map((c) => (
          <AddonCardView key={c.id} card={c} canManage={canManage} locale={locale} />
        ))}
      </div>
    </section>
  );
}

function AddonCardView({
  card,
  canManage,
  locale,
}: {
  card: AddonCard;
  canManage: boolean;
  locale: string;
}) {
  const t = useTranslations(NS);
  const price = formatMoney(card.offerAmount ?? card.amount, card.currency, locale);
  const bullets = card.grantBullets.map((b) =>
    b.kind === 'feature'
      ? b.label
      : b.kind === 'limit_unlimited'
        ? t('unlimitedBullet', { label: b.label })
        : t('addBullet', { amount: b.amount ?? 0, label: b.label }),
  );
  const blocked = card.state === 'active';
  const included = card.state === 'included';
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5"
      data-testid={`addon-${card.slug}`}
    >
      <div>
        <h3 className="font-semibold">{card.name}</h3>
        {card.subtitle && <p className="text-sm text-muted-foreground">{card.subtitle}</p>}
      </div>
      <p className="text-2xl font-semibold">
        {price}{' '}
        <span className="text-sm font-normal text-muted-foreground">
          {card.isLifetime
            ? t('oneTime')
            : t(`per.${card.billingUnit}`, { count: card.billingDuration })}
        </span>
      </p>
      <ul className="space-y-1 text-sm">
        {bullets.slice(0, 6).map((b, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className="text-success">
              ✓
            </span>
            {b}
          </li>
        ))}
      </ul>
      {included ? (
        <div className="space-y-1" data-testid={`addon-${card.slug}-included`}>
          <Badge tone="success" className="self-start">
            {t('included')}
          </Badge>
          {card.ownedCount > 0 && (
            <p className="text-xs text-muted-foreground" data-testid={`addon-${card.slug}-note`}>
              {!card.ownedRenews && card.ownedEndsAt
                ? t('includedEnds', {
                    date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                      new Date(card.ownedEndsAt),
                    ),
                  })
                : t('includedOwned')}
            </p>
          )}
        </div>
      ) : blocked ? (
        <Badge tone="success" className="self-start">
          {t('active')}
        </Badge>
      ) : canManage ? (
        <Link
          href={checkoutPath(card.slug)}
          className="mt-auto inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
        >
          {card.state === 'buy_again' ? t('buyAgain') : t('buy')}
        </Link>
      ) : null}
    </div>
  );
}
