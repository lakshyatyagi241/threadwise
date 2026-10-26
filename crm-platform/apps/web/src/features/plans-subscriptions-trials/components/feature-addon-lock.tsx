'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { planBillingUnitSchema, type FeatureAddon } from '@crm/contracts';
import { Button, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { KEYS, enableAddonBySlug } from '@/features/addons-extension-registry/api';
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
 *  - `disabled`: the plan includes the add-on but the workspace turned it off: "{addon} is turned off" and a "Turn it on" button for a
 *    person who holds `addons.activation.manage`, else "Ask your account owner to turn it on". Never a buy offer;
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
  // The workspace's own switch beats every offer: the plan includes it, it is only turned off (never a buy or an upsell).
  const turnedOff = addons.find((a) => a.offer === 'disabled');
  if (turnedOff) return <TurnedOffLock addon={turnedOff} className={className} />;
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

/** The lock of an add-on the plan includes but the workspace turned off. */
function TurnedOffLock({ addon, className }: { addon: FeatureAddon; className?: string }) {
  const t = useTranslations(`${NS}.lock`);
  const can = useCan('addons.activation.manage');
  const titleId = useId();
  const box = `rounded-xl border border-border bg-background p-4 ${className ?? ''}`.trim();
  return (
    <section
      className={box}
      aria-labelledby={titleId}
      data-testid="feature-addon-lock"
      data-offer="disabled"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {t('disabledTitle', { addon: addon.addonName })}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('disabledLead', { addon: addon.addonName })}
      </p>
      {can ? (
        <TurnOnButton addon={addon} />
      ) : (
        <p className="mt-2 text-sm font-medium" data-testid="feature-addon-lock-ask-on">
          {t('disabledAsk')}
        </p>
      )}
    </section>
  );
}

function TurnOnButton({ addon }: { addon: FeatureAddon }) {
  const t = useTranslations(`${NS}.lock`);
  const qc = useQueryClient();
  const router = useRouter();
  const [failed, setFailed] = useState<'forbidden' | 'failed' | null>(null);
  const turnOn = useMutation({
    mutationFn: () => enableAddonBySlug(addon.addonSlug),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.workspace });
      // The menu and the locks are drawn from the entitlements the workspace layout reads on the server.
      router.refresh();
    },
    onError: (e) => setFailed(e instanceof ApiError && e.status === 403 ? 'forbidden' : 'failed'),
  });
  return (
    <div className="mt-3 space-y-2">
      <Button
        data-testid="feature-addon-lock-turn-on"
        disabled={turnOn.isPending}
        onClick={() => {
          setFailed(null);
          turnOn.mutate();
        }}
      >
        {turnOn.isPending && <Spinner />}
        {t('turnOn')}
      </Button>
      <div aria-live="polite">
        {failed && (
          <p role="alert" className="text-sm text-danger" data-testid="feature-addon-lock-error">
            {t(failed === 'forbidden' ? 'turnOnForbidden' : 'turnOnFailed', {
              addon: addon.addonName,
            })}
          </p>
        )}
      </div>
    </div>
  );
}
