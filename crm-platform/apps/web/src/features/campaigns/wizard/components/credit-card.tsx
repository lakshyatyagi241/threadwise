'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { WizardCreditCheck } from '@crm/contracts';
import { Alert } from '@crm/ui';
import { formatMinor } from '../lib/money';
import { ErrorBlock, Skeleton, WizardCard } from './parts';

export interface CreditQuery {
  data?: WizardCreditCheck;
  isPending: boolean;
  isFetching?: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

function useCountryName() {
  const locale = useLocale();
  const t = useTranslations('campaigns.wizard.review');
  return (code: string | null) => {
    if (!code) return t('unknownCountry');
    try {
      return new Intl.DisplayNames(locale, { type: 'region' }).of(code) ?? code;
    } catch {
      return code;
    }
  };
}

/** Wallet balance against the estimated cost; when it does not cover the send, the shortfall and a way to top up. */
export function CreditCard({ credit }: { credit: CreditQuery }) {
  const t = useTranslations('campaigns.wizard.review');
  const locale = useLocale();
  const country = useCountryName();
  const c = credit.data;
  const money = (minor: number) => (c ? formatMinor(minor, c.currency, locale) : '');
  return (
    <WizardCard title={t('creditTitle')} hint={t('creditHint')} id="review-credit">
      {credit.isPending ? (
        <Skeleton label={t('creditLoading')} lines={3} />
      ) : credit.isError || !c ? (
        <div className="space-y-2">
          <ErrorBlock error={credit.error} onRetry={() => void credit.refetch()} />
          <p className="text-xs text-muted-foreground">{t('creditUnverified')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {c.sufficient ? (
            <Alert tone="success">{t('creditOk')}</Alert>
          ) : (
            <Alert tone="danger" data-testid="insufficient">
              <strong className="block">{t('insufficientTitle')}</strong>
              <span className="block">
                {t('insufficient', { shortfall: money(c.shortfallMinor) })}
              </span>
              <a
                href={c.topupUrl}
                className="mt-2 inline-flex h-8 items-center rounded-md bg-danger px-3 text-sm font-medium text-danger-foreground hover:opacity-90"
              >
                {t('topUp')}
              </a>
            </Alert>
          )}
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t('balance')}</dt>
              <dd className="text-lg font-semibold tabular-nums">{money(c.balanceMinor)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('estimatedCostFull')}</dt>
              <dd className="text-lg font-semibold tabular-nums">{money(c.fullCostMinor)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('messages')}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {c.recipients.toLocaleString()}
              </dd>
            </div>
          </dl>
          {c.platformOwned ? (
            <p className="text-sm font-medium" data-testid="charged-now">
              {t('platformOwned')}
            </p>
          ) : (
            <>
              <p className="text-sm font-medium" data-testid="charged-now">
                {c.billingMode === 'plan'
                  ? t('chargedPlan', {
                      amount: money(c.estimatedCostMinor),
                      covered: c.recipients - c.chargeableMessages,
                    })
                  : t('chargedWallet', { amount: money(c.estimatedCostMinor) })}
              </p>
              <p className="text-sm text-muted-foreground">
                {c.billingMode === 'plan'
                  ? t('modePlan', { count: c.chargeableMessages })
                  : t('modeWallet', { count: c.chargeableMessages })}
              </p>
            </>
          )}
          {c.lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('breakdown')}</caption>
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th scope="col" className="py-1.5 pe-3 text-start font-medium">
                      {t('country')}
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-end font-medium">
                      {t('messages')}
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-end font-medium">
                      {t('unitPrice')}
                    </th>
                    <th scope="col" className="ps-3 py-1.5 text-end font-medium">
                      {t('subtotal')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {c.lines.map((l, i) => (
                    <tr
                      key={`${l.country ?? 'unknown'}-${i}`}
                      className="border-b border-border/60"
                    >
                      <th scope="row" className="py-1.5 pe-3 text-start font-normal">
                        {country(l.country)}
                      </th>
                      <td className="px-3 py-1.5 text-end tabular-nums">
                        {l.messages.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-end tabular-nums">
                        {money(l.unitPriceMinor)}
                      </td>
                      <td className="ps-3 py-1.5 text-end tabular-nums">
                        {money(l.fullSubtotalMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </WizardCard>
  );
}
