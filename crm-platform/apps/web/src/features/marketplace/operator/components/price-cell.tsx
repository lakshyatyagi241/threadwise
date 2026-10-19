'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { MarketPricingView } from '@crm/contracts';
import { Badge } from '@crm/ui';
import { priceLabel } from '../lib/pricing';

const NS = 'marketplace.operator.price';

type PriceFacts = Pick<
  MarketPricingView,
  'model' | 'amount' | 'currency' | 'annualAmount' | 'trialDays' | 'purchasable'
>;

/** A monthly price with its "per month" words; the figure is its own left-to-right run so the currency symbol stays put in Arabic. */
export function PerMonth({ price }: { price: string }) {
  const t = useTranslations(NS);
  return (
    <>
      <bdi dir="ltr" className="tabular-nums">
        {price}
      </bdi>{' '}
      <span>{t('perMonth')}</span>
    </>
  );
}

/** A yearly price with its "per year" words (a subscription bought for a year). */
export function PerYear({ price }: { price: string }) {
  const t = useTranslations(NS);
  return (
    <>
      <bdi dir="ltr" className="tabular-nums">
        {price}
      </bdi>{' '}
      <span>{t('perYear')}</span>
    </>
  );
}

/**
 * A listing's price in the catalogue: "Free", or the monthly price with the length of the trial and a marker when the app is not on
 * sale (no new subscriptions, existing subscribers may renew).
 */
export function PriceCell({ pricing }: { pricing: PriceFacts }) {
  const t = useTranslations(NS);
  const locale = useLocale();
  const label = priceLabel(pricing, locale);
  if (label.kind === 'free') return <span data-testid="price-free">{t('free')}</span>;
  return (
    <div className="space-y-1" data-testid="price-paid">
      <div className="font-medium">
        <PerMonth price={label.price} />
      </div>
      {label.trialDays > 0 && (
        <div className="text-xs text-muted-foreground">
          {t('trial', { count: label.trialDays })}
        </div>
      )}
      {!label.onSale && <Badge tone="warning">{t('notOnSale')}</Badge>}
    </div>
  );
}
