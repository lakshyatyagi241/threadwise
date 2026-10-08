'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { VisibleAddon } from '@crm/contracts';
import { Badge } from '@crm/ui';
import { mktRoutes } from '@/features/marketplace/lib/routes';
import { formatMoney } from '../lib/format';

const NS = 'plans-subscriptions-trials';

/**
 * "Add-ons available on your plan": the Marketplace apps the workspace's current plan makes visible, each as owned or with a link to
 * the app's page in the Marketplace, where it is subscribed to. Hidden when the plan makes none visible.
 */
export function PlanAddons({ addons }: { addons: readonly VisibleAddon[] }) {
  const t = useTranslations(`${NS}.planAddons`);
  const tp = useTranslations(`${NS}.plans`);
  const locale = useLocale();
  const titleId = useId();
  if (addons.length === 0) return null;

  return (
    <section aria-labelledby={titleId} className="space-y-3" data-testid="plan-addons">
      <div className="space-y-1">
        <h2 id={titleId} className="text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {addons.map((a) => (
          <li
            key={a.id}
            data-testid={`plan-addon-${a.app.slug}`}
            data-owned={a.owned}
            className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4"
          >
            <p className="min-w-0 break-words font-semibold">{a.app.name}</p>
            <p className="text-lg font-semibold">
              {formatMoney(a.price.amount, a.price.currency, locale)}{' '}
              <span className="text-sm font-normal text-muted-foreground">
                {tp(`perUnit.${a.price.period.unit}`, { count: a.price.period.count })}
              </span>
            </p>
            {a.owned ? (
              <Badge tone="success" className="self-start">
                {t('owned')}
              </Badge>
            ) : (
              <Link
                href={mktRoutes.app(a.app.slug)}
                aria-label={t('buyLabel', { name: a.app.name })}
                className="mt-auto inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('buy')}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
