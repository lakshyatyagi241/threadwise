'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { MarketCardPricing } from '@crm/contracts';
import { Alert, Badge, Button, Spinner, cn } from '@crm/ui';
import { acquireFor, priceChip, priceLine, pricingView } from '../lib/pricing';
import { ErrorLine, Section } from './ui';
import { useSubscribe } from './use-subscription-actions';

/** The pieces that say what an app costs and let a workspace subscribe to it. Wording is `marketplace.card.pricing`, `.pricing`, `.subscribe`. */

/** The price line of a card or of the app page: Free, "$9 / month", Included in your plan, Subscribed or Not for sale, and the trial chip. */
export function PriceText({
  pricing,
  className,
}: {
  pricing: MarketCardPricing;
  className?: string;
}) {
  const t = useTranslations('marketplace.card.pricing');
  const locale = useLocale();
  const line = priceLine(pricing, locale);
  const chip = priceChip(pricing, locale);
  return (
    <span
      data-testid="price-line"
      data-access={pricing.access}
      data-availability={pricing.availability}
      className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}
    >
      {chip && (
        <Badge tone="neutral" data-testid="addon-chip">
          {t('addOn')}
        </Badge>
      )}
      <span>
        {line.key === 'monthly' ? t('monthly', { price: line.price ?? '' }) : t(line.key)}
      </span>
      {line.trialDays !== null && (
        <Badge tone="success" data-testid="trial-chip">
          {t('trial', { days: line.trialDays })}
        </Badge>
      )}
    </span>
  );
}

/**
 * An add-on the plan lists and the workspace has not bought: Install is shown disabled, with the reason, so it is clear why it cannot
 * be used yet. Subscribe stands beside it (the caller draws it). `label` is the Install button's own wording.
 */
export function NeedsPurchaseInstall({ id, label }: { id: string; label: string }) {
  const t = useTranslations('marketplace.pricing');
  return (
    <div data-testid="needs-purchase" className="min-w-0 space-y-1.5">
      <Button type="button" variant="secondary" disabled aria-describedby={id}>
        {label}
      </Button>
      <p id={id} className="text-xs text-muted-foreground">
        {t('needsPurchase')}
      </p>
    </div>
  );
}

/** The app page's pricing block: the price, the trial on offer, why it is free when the plan includes it, and how a paid month works. */
export function PricingBlock({ pricing }: { pricing: MarketCardPricing }) {
  const t = useTranslations('marketplace.pricing');
  const locale = useLocale();
  const view = pricingView(pricing, locale);
  return (
    <Section title={t('title')} id="pricing">
      <div data-testid="pricing-block" className="space-y-2 text-sm">
        <p className="text-lg font-semibold">
          <PriceText pricing={pricing} />
        </p>
        {view.line.key === 'free' && <p className="text-muted-foreground">{t('freeNote')}</p>}
        {view.includedNote && (
          <p className="text-muted-foreground">{t(`included.${view.includedNote}`)}</p>
        )}
        {view.line.key === 'subscribed' && (
          <p className="text-muted-foreground">{t('subscribedNote')}</p>
        )}
        {view.line.trialDays !== null && (
          <p data-testid="trial-offer">{t('trialOffer', { days: view.line.trialDays })}</p>
        )}
        {view.prepaidNote && <p className="text-muted-foreground">{t('prepaidNote')}</p>}
        {view.autoRenewNote && (
          <p className="text-muted-foreground" data-testid="auto-renew-note">
            {t('autoRenewNote')}
          </p>
        )}
        {view.line.key === 'notForSale' && (
          <p className="text-muted-foreground">{t('notForSale.message')}</p>
        )}
      </div>
    </Section>
  );
}

/** A paid app the platform stopped selling to newcomers: nothing to press, so a note instead of a disabled button. */
export function NotForSaleNote() {
  const t = useTranslations('marketplace.pricing.notForSale');
  return (
    <Alert tone="info" data-testid="not-for-sale">
      <p className="font-medium">{t('title')}</p>
      <p>{t('message')}</p>
    </Alert>
  );
}

/**
 * Subscribe, and Start free trial when the workspace may. Both are real calls (see `useSubscribe`); the buttons are disabled while one
 * runs, so a second click cannot start a second one.
 */
export function SubscribeActions({
  app,
  hint = true,
}: {
  app: { slug: string; name: string; pricing: MarketCardPricing };
  /** The line under the buttons ("$9 / month, paid at checkout"). */
  hint?: boolean;
}) {
  const t = useTranslations('marketplace.subscribe');
  const locale = useLocale();
  const sub = useSubscribe(app);
  const acquire = acquireFor(app.pricing, locale);
  if (acquire.kind !== 'subscribe') return null;
  return (
    <div className="space-y-2" data-testid="subscribe-actions">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void sub.run(false)} disabled={sub.pending}>
          {sub.pending && sub.mode === 'pay' && <Spinner />}
          {t('subscribe')}
          <span className="sr-only"> — {app.name}</span>
        </Button>
        {acquire.trialDays !== null && (
          <Button variant="secondary" onClick={() => void sub.run(true)} disabled={sub.pending}>
            {sub.pending && sub.mode === 'trial' && <Spinner />}
            {t('startTrial', { days: acquire.trialDays })}
            <span className="sr-only"> — {app.name}</span>
          </Button>
        )}
      </div>
      {hint && (
        <p className="text-xs text-muted-foreground">
          {acquire.price
            ? t(acquire.automatic ? 'hintPriceAuto' : 'hintPrice', { price: acquire.price })
            : t(acquire.automatic ? 'hintAuto' : 'hint')}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {sub.pending ? t('working') : ''}
      </p>
      {sub.error ? <ErrorLine error={sub.error} /> : null}
      {sub.noCheckout && (
        <Alert tone="danger" data-testid="no-checkout">
          {t('noCheckout')}
        </Alert>
      )}
    </div>
  );
}

/** What an install page, or a manage page of an app that became paid, shows in place of the permission step: the offer to subscribe. */
export function SubscribePanel({
  app,
  title,
  description,
}: {
  app: { slug: string; name: string; pricing: MarketCardPricing };
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <Section title={title} description={description}>
      <div data-testid="subscribe-panel" className="space-y-3">
        <p className="text-lg font-semibold">
          <PriceText pricing={app.pricing} />
        </p>
        <SubscribeActions app={app} />
      </div>
    </Section>
  );
}
