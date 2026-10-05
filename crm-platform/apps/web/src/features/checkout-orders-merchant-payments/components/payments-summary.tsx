'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePaymentSummary } from '../api/hooks';
import { formatInt, formatMoney } from '../lib/format';
import { ErrorPanel, Eyebrow, Skeleton, ToneBadge } from './parts';
import type { Tone } from '../lib/status';

/** The money side at a glance: order counts by payment state and what was collected, per currency. */
export function PaymentsSummary() {
  const t = useTranslations('checkout-orders-merchant-payments.payments.summary');
  const status = useTranslations('checkout-orders-merchant-payments.paymentStatus');
  const locale = useLocale();
  const q = usePaymentSummary();

  if (q.isPending) {
    return (
      <div role="status" aria-label={t('loading')} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />;

  const s = q.data;
  const tiles: { key: string; label: string; value: number; tone: Tone }[] = [
    { key: 'paid', label: status('paid'), value: s.paid, tone: 'success' },
    { key: 'awaiting', label: status('awaiting'), value: s.awaiting, tone: 'warning' },
    { key: 'cod', label: status('cod'), value: s.cod, tone: 'neutral' },
    { key: 'unpaid', label: status('unpaid'), value: s.unpaid, tone: 'danger' },
  ];

  return (
    <div className="space-y-3" data-testid="payments-summary">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            data-testid={`summary-${tile.key}`}
            className="rounded-xl border border-border bg-background p-4"
          >
            <ToneBadge tone={tile.tone}>{tile.label}</ToneBadge>
            <div className="mt-2 text-2xl font-semibold tabular-nums">
              {formatInt(tile.value, locale)}
            </div>
            <div className="text-xs text-muted-foreground">{t('orders')}</div>
          </div>
        ))}
      </div>
      <div
        className="rounded-xl border border-border bg-background p-4"
        data-testid="summary-collected"
      >
        <Eyebrow>{t('collected')}</Eyebrow>
        {s.collected.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('collectedNone')}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
            {s.collected.map((c) => (
              <li key={c.currencyCode} className="text-xl font-semibold tabular-nums">
                {formatMoney(c.totalMinor, c.currencyCode, locale)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
