'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Alert, cn } from '@crm/ui';
import { formatMinor } from '../../wizard/lib/money';
import type { CreditQuery } from '../../wizard/components/credit-card';

/**
 * The cost of the selected audience with the draft's template, and whether the wallet covers it: the same check (and numbers) as
 * the Review step's credit card, in the preview column so it is in view from the first contact picked. Inside the plan's monthly
 * allowance the cost is the wallet's $0 and the note says so, as Review does. A platform-owned workspace is never billed: the note
 * says that, and the balance warnings (which do not apply to it) are left out.
 */
export function CostPanel({
  credit,
  hasTemplate,
  hasAudience,
}: {
  credit: CreditQuery;
  hasTemplate: boolean;
  hasAudience: boolean;
}) {
  const t = useTranslations('campaigns.builder.guided');
  const tr = useTranslations('campaigns.wizard.review');
  const locale = useLocale();
  const c = credit.data;
  const money = (minor: number) => (c ? formatMinor(minor, c.currency, locale) : '');
  return (
    <section
      aria-label={t('costTitle')}
      aria-busy={credit.isFetching}
      className="rounded-xl border border-border bg-background"
      data-testid="cost-panel"
    >
      <header className="border-b border-border px-4 py-2">
        <h2 className="text-base font-semibold">{t('costTitle')}</h2>
      </header>
      <div className="space-y-3 p-3 text-sm">
        {!hasTemplate ? (
          <p className="py-3 text-center text-muted-foreground">{t('costNoTemplate')}</p>
        ) : !hasAudience ? (
          <p className="py-3 text-center text-muted-foreground">{t('costNoAudience')}</p>
        ) : credit.isPending ? (
          <div role="status" aria-label={t('costLoading')} className="animate-pulse space-y-2">
            <div className="h-4 rounded bg-muted" />
            <div className="h-4 w-2/3 rounded bg-muted" />
          </div>
        ) : credit.isError || !c ? (
          <Alert tone="warning">{t('costError')}</Alert>
        ) : (
          <div className={cn('space-y-3 transition-opacity', credit.isFetching && 'opacity-60')}>
            <dl className="space-y-1.5">
              <div className="flex justify-between gap-3">
                <dt>{tr('estimatedCostFull')}</dt>
                <dd className="font-medium tabular-nums">{money(c.fullCostMinor)}</dd>
              </div>
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>{t('chargedNowLabel')}</dt>
                <dd className="tabular-nums" data-testid="charged-now">
                  {money(c.estimatedCostMinor)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>{tr('balance')}</dt>
                <dd className="font-medium tabular-nums">{money(c.balanceMinor)}</dd>
              </div>
            </dl>
            {c.platformOwned ? null : c.sufficient ? (
              c.balanceMinor >= c.fullCostMinor ? (
                <Alert tone="success">{t('balanceOk', { full: money(c.fullCostMinor) })}</Alert>
              ) : (
                <Alert tone="warning">
                  {t('balanceLowFull', { full: money(c.fullCostMinor) })}
                </Alert>
              )
            ) : (
              <Alert tone="danger" data-testid="insufficient">
                {t('balanceShort', { shortfall: money(c.shortfallMinor) })}{' '}
                <a href={c.topupUrl} className="font-semibold underline">
                  {tr('topUp')}
                </a>
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">
              {c.platformOwned
                ? tr('platformOwned')
                : c.billingMode === 'plan'
                  ? tr('chargedPlan', {
                      amount: money(c.estimatedCostMinor),
                      covered: c.recipients - c.chargeableMessages,
                    })
                  : tr('chargedWallet', { amount: money(c.estimatedCostMinor) })}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
