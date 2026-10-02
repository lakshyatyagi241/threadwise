'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { PaymentSummaryResponse } from '@crm/contracts';
import { SUMMARY_DAYS, type SummaryDays } from '../lib/payment-filters';
import { summaryByCurrency } from '../lib/summary';
import { Money } from './parts';

/**
 * The four figures over the ledger, one row per currency (amounts of different currencies are never added together): collected
 * and refunded in the chosen window, and what is outstanding and overdue right now with the number of invoices behind each.
 */
export function LedgerSummary({
  summary,
  loading,
  error,
  days,
  onDays,
  currency,
}: {
  summary: PaymentSummaryResponse | undefined;
  loading: boolean;
  error: boolean;
  days: SummaryDays;
  onDays: (d: SummaryDays) => void;
  currency: string;
}) {
  const t = useTranslations('invoicing.payments.kpi');
  const rows = summary ? summaryByCurrency(summary, currency || undefined) : [];
  return (
    <section
      aria-label={t('label')}
      className="space-y-3 rounded-xl border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('heading')}</h2>
        <div
          role="group"
          aria-label={t('window')}
          className="inline-flex rounded-md border border-border p-0.5"
        >
          {SUMMARY_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => onDays(d)}
              className={cn(
                'h-8 min-w-14 rounded px-3 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
                days === d
                  ? 'bg-brand text-brand-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t('days', { count: d })}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-muted-foreground">{t('failed')}</p>
      ) : loading || !summary ? (
        <div
          role="status"
          aria-label={t('loading')}
          className="h-24 animate-pulse rounded-lg bg-muted/50"
        />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.currency} className="space-y-1.5">
              {rows.length > 1 && (
                <div className="text-xs font-semibold text-muted-foreground">{r.currency}</div>
              )}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label={t('collected', { days })} tone="success">
                  <Money minor={r.collected} currency={r.currency} />
                </Kpi>
                <Kpi label={t('refunded', { days })} tone={r.refunded > 0 ? 'danger' : undefined}>
                  <Money minor={r.refunded} currency={r.currency} />
                </Kpi>
                <Kpi
                  label={t('outstanding')}
                  hint={t('invoices', { count: r.outstandingInvoices })}
                >
                  <Money minor={r.outstanding} currency={r.currency} />
                </Kpi>
                <Kpi
                  label={t('overdue')}
                  hint={t('invoices', { count: r.overdueInvoices })}
                  tone={r.overdue > 0 ? 'danger' : undefined}
                >
                  <Money minor={r.overdue} currency={r.currency} />
                </Kpi>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Kpi({
  label,
  hint,
  tone,
  children,
}: {
  label: string;
  hint?: string;
  tone?: 'success' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 truncate text-xl font-semibold',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
        )}
      >
        {children}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
