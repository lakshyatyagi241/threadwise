'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReferralHistoryResponse } from '@crm/contracts';
import { EmptyState } from '@crm/ui';
import { plusMoney } from '../lib/format';

type TopCodes = ReferralHistoryResponse['topCodes'];

/** The top 5 codes of the range with a bar proportional to their signups (never thinner than 2%). */
export function TopCodes({
  codes,
  currency,
  rangeLabel,
}: {
  codes: TopCodes;
  currency: string;
  rangeLabel: string;
}) {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.top');
  const locale = useLocale();
  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <div className="text-xs font-medium text-muted-foreground">{t('title')}</div>
      <h2 className="mb-3 mt-0.5 text-lg font-semibold leading-tight">{rangeLabel}</h2>
      {codes.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="space-y-3">
          {codes.map((c) => (
            <li key={c.code}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-mono">{c.code}</span>
                <span className="font-mono">{t('signups', { count: c.signups })}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  data-top-bar
                  className="h-full bg-primary"
                  style={{ width: `${Math.max(2, Math.min(100, c.pct))}%` }}
                />
              </div>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                {plusMoney(c.creditsMinor, currency, locale)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
