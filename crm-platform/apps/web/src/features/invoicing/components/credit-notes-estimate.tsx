'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { CreditNoteSettlement } from '@crm/contracts';
import { Alert } from '@crm/ui';
import { formatMoney } from '../lib/money';
import { moneyEffect, num, qtyText, taxRowLabel, type Estimate } from '../lib/credit-notes';
import { Money } from './parts';

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${strong ? 'border-t border-border pt-2 text-base font-bold' : ''} ${muted ? 'text-xs text-muted-foreground' : ''}`}
    >
      <dt className={strong || muted ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The live estimate of the credit, with the tax summary per rate and what it does to the money. It is an estimate: the figures
 * are priced with the same rule the server uses, but the server's figures are the truth once the credit note is saved.
 */
export function CreditEstimate({
  estimate,
  currency,
  settlement,
  totalMinor,
  creditedMinor,
  paidMinor,
}: {
  estimate: Estimate;
  currency: string;
  settlement: CreditNoteSettlement;
  /** The invoice's figures (minor units). */
  totalMinor: bigint;
  creditedMinor: bigint;
  paidMinor: bigint;
}) {
  const t = useTranslations('invoicing.creditNotes.estimate');
  const locale = useLocale();
  const empty = estimate.lines.length === 0;
  const effect = moneyEffect({
    totalMinor,
    creditedMinor,
    paidMinor,
    creditMinor: estimate.totalMinor,
    settlement,
  });
  const money = (n: bigint) => <Money minor={num(n)} currency={currency} />;
  const fmt = (n: bigint) => formatMoney(num(n), currency, locale);

  return (
    <section
      aria-label={t('title')}
      className="space-y-3 rounded-xl border border-border bg-background p-4"
    >
      <div>
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('disclaimer')}</p>
      </div>

      {empty ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border text-sm">
            {estimate.lines.map((l) => (
              <li key={l.key} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="block truncate" dir="auto" title={l.description}>
                    {l.description}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {l.invoiceLineId ? t('lineQty', { qty: qtyText(l.qtyScaled) }) : null}
                    {l.invoiceLineId && l.taxLabel ? ' · ' : null}
                    {l.taxLabel}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums">{money(l.totalMinor)}</span>
              </li>
            ))}
          </ul>

          {estimate.taxSummary.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('taxSummary')}
              </h3>
              <ul className="space-y-1 text-xs">
                {estimate.taxSummary.map((g) => (
                  <li
                    key={`${g.name}-${g.rate}-${g.inclusive}`}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="min-w-0 truncate" dir="auto">
                      {taxRowLabel(g.name, g.rate)}
                      {g.inclusive ? ` (${t('included')})` : ''}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground" dir="auto">
                      {t('taxOn', { tax: fmt(g.taxMinor), base: fmt(g.baseMinor) })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <dl className="space-y-1.5 text-sm">
            <Row label={t('subtotal')} value={money(estimate.subtotalMinor)} />
            <Row label={t('tax')} value={money(estimate.taxMinor)} />
            <Row label={t('total')} value={money(estimate.totalMinor)} strong />
          </dl>

          {estimate.exceeds && (
            <Alert tone="warning">{t('exceeds', { max: fmt(estimate.creditableMinor) })}</Alert>
          )}

          <div className="space-y-1.5 rounded-md bg-muted/50 p-3 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('money')}
            </h3>
            <dl className="space-y-1">
              <Row label={t('balanceBefore')} value={money(effect.balanceBeforeMinor)} />
              <Row label={t('balanceAfter')} value={money(effect.balanceAfterMinor)} />
              <Row label={t('applied')} value={money(effect.appliedMinor)} />
              <Row label={t('refunded')} value={money(effect.refundMinor)} />
            </dl>
            <p className="text-xs text-muted-foreground">
              {t(settlement === 'refund' ? 'refundNote' : 'balanceNote')}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
