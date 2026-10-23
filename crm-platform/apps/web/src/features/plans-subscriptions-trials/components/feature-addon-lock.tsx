'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { planBillingUnitSchema, type FeatureAddon } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useFeatureAddons, usePlanFeatureList } from '@/lib/plan-features';
import { PLANS_PATH, formatMoney } from '../lib/format';
import { AddonLockLink } from './addon-lock';

const NS = 'plans-subscriptions-trials';

/** "₹199.00 / month": the add-on's price for its billing period, with the same words as the plan cards. */
export function useAddonPrice(): (a: FeatureAddon) => string {
  const tp = useTranslations(`${NS}.plans`);
  const locale = useLocale();
  return (a) => {
    const money = formatMoney(a.amount, a.currency, locale);
    const unit = planBillingUnitSchema.safeParse(a.billingUnit);
    return unit.success
      ? `${money} ${tp(`perUnit.${unit.data}`, { count: Math.max(1, a.billingDuration) })}`
      : money;
  };
}

/**
 * The one card a locked part of a screen shows in its place (docs/specs/addons-plan-offers.md, section 4), named from the data the
 * workspace layout reads from `GET /billing/entitlements` (`featureAddons`), never from code:
 *  - `buy`: "Add Smart routing for ₹199.00 / month", a link to the add-ons list for a person who may buy (`paygw.checkout.create`), else
 *    "Ask your account owner";
 *  - `unavailable`: the add-on needs an active paid plan, with a link to the plans;
 *  - `hidden`: the workspace's plan does not offer the add-on at all, so nothing is drawn (no upsell);
 *  - `included` / `owned` / no add-on known: the generic lock, only while the feature is still off (an override switched it off).
 * With several keys the first `buy`, else `unavailable`, offer speaks; any `hidden` one hides the card. `off` is the caller's (the server's)
 * answer that the part is locked; without it the card shows only when a key is known to be off. Unknown entitlements show nothing.
 */
export function FeatureAddonLock({
  feature,
  off,
  className,
}: {
  feature: string | readonly string[];
  /** The part is locked by the server's own answer (for example a settings call's `available.*`). */
  off?: boolean;
  className?: string;
}) {
  const t = useTranslations(`${NS}.lock`);
  const keys = typeof feature === 'string' ? [feature] : feature;
  const addons = useFeatureAddons(keys);
  const has = usePlanFeatureList(keys);
  const canBuy = useCan('paygw.checkout.create');
  const price = useAddonPrice();
  const titleId = useId();

  const isOff = off ?? has.some((h) => !h);
  if (!isOff) return null;
  const pick =
    addons.find((a) => a.offer === 'buy') ?? addons.find((a) => a.offer === 'unavailable') ?? null;
  // Nothing on offer and the plan hides an add-on that would give it: draw nothing (one that is still sold elsewhere wins above).
  if (!pick && addons.some((a) => a.offer === 'hidden')) return null;

  const box = `rounded-xl border border-border bg-background p-4 ${className ?? ''}`.trim();
  const link =
    'inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary';

  if (!pick) {
    return (
      <section
        className={box}
        aria-labelledby={titleId}
        data-testid="feature-addon-lock"
        data-offer="off"
      >
        <h2 id={titleId} className="text-sm font-semibold">
          {t('offTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('offLead')} <AddonLockLink />
        </p>
      </section>
    );
  }

  if (pick.offer === 'unavailable') {
    return (
      <section
        className={box}
        aria-labelledby={titleId}
        data-testid="feature-addon-lock"
        data-offer="unavailable"
      >
        <h2 id={titleId} className="text-sm font-semibold">
          {t('unavailableTitle', { addon: pick.addonName })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('unavailableLead', { addon: pick.addonName })}
        </p>
        <Link href={PLANS_PATH} className={`mt-3 ${link}`}>
          {t('viewPlans')}
        </Link>
      </section>
    );
  }

  return (
    <section
      className={box}
      aria-labelledby={titleId}
      data-testid="feature-addon-lock"
      data-offer="buy"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {t('buyTitle', { addon: pick.addonName, price: price(pick) })}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('buyLead', { addon: pick.addonName })}
      </p>
      {canBuy ? (
        <Link href={PLANS_PATH} className={`mt-3 ${link}`} data-testid="feature-addon-lock-buy">
          {t('buyLink')}
        </Link>
      ) : (
        <p className="mt-2 text-sm font-medium" data-testid="feature-addon-lock-ask">
          {t('askOwner')}
        </p>
      )}
    </section>
  );
}
