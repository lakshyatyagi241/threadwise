'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '../lib/money';
import { taxLabel, type TotalsView } from '../lib/totals';

/**
 * Live totals beside the builder: subtotal, discount, shipping, the tax summary per rate (name, rate, taxable base, tax, whether the
 * price already contained it: a compound rate shows its parts, CGST and SGST, as rows of their own) and the total. The figures
 * are `computeInvoice`'s (and the tax engine's for compound taxes); after a save the server's own figures replace them.
 */
export function TotalsCard({
  totals,
  currency,
  reverseCharge,
  issues,
}: {
  totals: TotalsView;
  currency: string;
  /** The buyer accounts for the tax: no tax is charged on this invoice. */
  reverseCharge?: boolean;
  /** Problems that stopped the figures (shown instead of silently showing zero). */
  issues?: string[];
}) {
  const t = useTranslations('invoicing.totals');
  const locale = useLocale();
  const money = (n: number) => formatMoney(n, currency, locale);
  const row = (label: string, value: string, key?: string, muted?: boolean) => (
    <div
      key={key ?? label}
      className={`flex items-baseline justify-between gap-3 ${muted ? 'text-xs text-muted-foreground' : ''}`}
    >
      <dt className={muted ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd dir="ltr" className="tabular-nums">
        {value}
      </dd>
    </div>
  );
  return (
    <section
      aria-label={t('label')}
      className="rounded-lg border border-border bg-background p-4 text-sm"
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('title')}
      </h2>
      {issues && issues.length > 0 && (
        <ul role="alert" className="mb-3 list-disc space-y-0.5 ps-4 text-xs text-danger">
          {issues.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <dl className="space-y-1.5" aria-live="polite">
        {row(t('subtotal'), money(totals.subtotalMinor))}
        {totals.discountMinor > 0 && row(t('discount'), `-${money(totals.discountMinor)}`)}
        {totals.shippingMinor > 0 && row(t('shipping'), money(totals.shippingMinor))}
        {totals.taxRows.map((g) => {
          const label = taxLabel(g.name, g.ratePercent);
          return (
            <div
              key={`${g.name}-${g.ratePercent}-${g.inclusive}`}
              className="flex items-baseline justify-between gap-3"
            >
              <dt className="min-w-0 text-muted-foreground">
                <span dir="auto">{g.inclusive ? t('taxIncluded', { name: label }) : label}</span>
                <span className="block text-xs">{t('taxOn', { base: money(g.baseMinor) })}</span>
              </dt>
              <dd dir="ltr" className="shrink-0 tabular-nums">
                {money(g.taxMinor)}
              </dd>
            </div>
          );
        })}
        {reverseCharge && <div className="text-xs text-muted-foreground">{t('reverseCharge')}</div>}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-lg font-bold">
          <dt>{t('total')}</dt>
          <dd dir="ltr" className="tabular-nums">
            {money(totals.totalMinor)}
          </dd>
        </div>
        {totals.includedTaxMinor > 0 &&
          row(t('includesTotal'), money(totals.includedTaxMinor), 'inc', true)}
      </dl>
    </section>
  );
}
