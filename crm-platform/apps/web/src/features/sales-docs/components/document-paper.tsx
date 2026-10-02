'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@crm/ui';
import { formatDay, formatInstantDay, percentText, qtyText } from '../lib/format';
import { formatMoney } from '../lib/money';
import type { PaperDoc } from '../lib/paper';
import type { DocStatus } from '../lib/status';

/**
 * The printed document. It is a sheet of paper, so it keeps its own light colours in both themes: what is previewed in the
 * builder, what the buyer opens and what comes out of the printer are the same thing. Everything it shows comes from the flat
 * `PaperDoc`, so one component serves the live preview, a saved document and the public page.
 */
const INK = 'text-[#0f172a]';
const MUTED = 'text-[#64748b]';
const RULE = 'border-[#e2e8f0]';

const STAMP: Partial<Record<DocStatus, string>> = {
  draft: 'border-[#94a3b8] text-[#64748b]',
  accepted: 'border-[#15803d] text-[#15803d]',
  declined: 'border-[#b91c1c] text-[#b91c1c]',
  expired: 'border-[#b45309] text-[#b45309]',
  converted: 'border-[#0b5a45] text-[#0b5a45]',
};

function Label({ children }: { children: ReactNode }) {
  return (
    <div className={cn('text-[10px] font-semibold uppercase tracking-[0.12em]', MUTED)}>
      {children}
    </div>
  );
}

export function DocumentPaper({
  doc,
  zone,
  className,
  id,
}: {
  doc: PaperDoc;
  zone?: string;
  className?: string;
  id?: string;
}) {
  const t = useTranslations('sales-docs.paper');
  const tk = useTranslations('sales-docs.kind');
  const ts = useTranslations('sales-docs.status');
  const locale = useLocale();
  const money = (n: number) => formatMoney(n, doc.currency, locale);
  const showDiscount = doc.lines.some((l) => l.discount !== null);
  const rates = new Set(doc.lines.map((l) => l.taxRateBp));
  const showTax = rates.size > 1;
  const stamp = STAMP[doc.status];
  const buyerLines = [doc.buyer.name, doc.buyer.company, doc.buyer.email, doc.buyer.phone].filter(
    Boolean,
  );

  return (
    <article
      id={id}
      aria-label={t('label', { kind: tk(`${doc.kind}.singular`), number: doc.number || '' })}
      className={cn(
        'mx-auto w-full max-w-[820px] bg-white p-6 text-[13px] leading-relaxed shadow-sm sm:p-10',
        INK,
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {doc.seller.logoUrl ? (
            <img
              src={doc.seller.logoUrl}
              alt={doc.seller.name}
              className="mb-2 h-10 w-auto max-w-48 object-contain"
            />
          ) : (
            <div className="text-lg font-bold tracking-tight" dir="auto">
              {doc.seller.name || t('sellerFallback')}
            </div>
          )}
          {doc.seller.address && (
            <div className={cn('mt-1 whitespace-pre-line', MUTED)} dir="auto">
              {doc.seller.address}
            </div>
          )}
          {doc.seller.taxId && <div className={MUTED}>{doc.seller.taxId}</div>}
        </div>
        <div className="text-end">
          <div className={cn('text-[11px] font-semibold uppercase tracking-[0.16em]', MUTED)}>
            {tk(`${doc.kind}.singular`)}
          </div>
          <div className="mt-0.5 font-mono text-base font-semibold" dir="ltr">
            {doc.number || t('numberPending')}
          </div>
          {stamp && (
            <span
              className={cn(
                'mt-2 inline-block rounded border-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em]',
                stamp,
              )}
            >
              {ts(doc.status)}
            </span>
          )}
        </div>
      </header>

      <h2 className="mt-8 text-2xl font-semibold leading-tight tracking-tight" dir="auto">
        {doc.title || (
          <span className={MUTED}>{t('untitled', { kind: tk(`${doc.kind}.singular`) })}</span>
        )}
      </h2>

      <section className={cn('mt-6 grid gap-6 border-y py-4 sm:grid-cols-2', RULE)}>
        <div>
          <Label>{t('preparedFor')}</Label>
          <div className="mt-1.5 space-y-0.5" dir="auto">
            {buyerLines.length ? (
              buyerLines.map((l, i) => (
                <div key={`${l}${i}`} className={i === 0 ? 'font-semibold' : MUTED}>
                  {l}
                </div>
              ))
            ) : (
              <div className={MUTED}>{t('noBuyer')}</div>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:justify-items-end">
          <div className="sm:text-end">
            <dt>
              <Label>{t('issued')}</Label>
            </dt>
            <dd className="mt-1 tabular-nums">
              {formatInstantDay(doc.issuedAt, locale, zone) || '-'}
            </dd>
          </div>
          <div className="sm:text-end">
            <dt>
              <Label>{t('validUntil')}</Label>
            </dt>
            <dd className="mt-1 tabular-nums">{formatDay(doc.validUntil, locale) || '-'}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className={cn('border-b-2 text-start', RULE)}>
                <th
                  className={cn(
                    'pb-2 pe-2 text-start text-[10px] font-semibold uppercase tracking-[0.1em]',
                    MUTED,
                  )}
                >
                  {t('description')}
                </th>
                <th
                  className={cn(
                    'w-14 pb-2 text-end text-[10px] font-semibold uppercase tracking-[0.1em]',
                    MUTED,
                  )}
                >
                  {t('qty')}
                </th>
                <th
                  className={cn(
                    'w-24 pb-2 text-end text-[10px] font-semibold uppercase tracking-[0.1em]',
                    MUTED,
                  )}
                >
                  {t('unit')}
                </th>
                {showDiscount && (
                  <th
                    className={cn(
                      'w-14 pb-2 text-end text-[10px] font-semibold uppercase tracking-[0.1em]',
                      MUTED,
                    )}
                  >
                    {t('discount')}
                  </th>
                )}
                {showTax && (
                  <th
                    className={cn(
                      'w-14 pb-2 text-end text-[10px] font-semibold uppercase tracking-[0.1em]',
                      MUTED,
                    )}
                  >
                    {t('tax')}
                  </th>
                )}
                <th
                  className={cn(
                    'w-24 pb-2 text-end text-[10px] font-semibold uppercase tracking-[0.1em]',
                    MUTED,
                  )}
                >
                  {t('amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={3 + (showDiscount ? 1 : 0) + (showTax ? 1 : 0)}
                    className={cn('py-6 text-center', MUTED)}
                  >
                    {t('noItems')}
                  </td>
                </tr>
              ) : (
                doc.lines.map((l, i) => (
                  <tr key={i} className={cn('border-b align-top', RULE)}>
                    <td className="py-2.5 pe-2" dir="auto">
                      <span className="whitespace-pre-line">{l.description}</span>
                    </td>
                    <td className="py-2.5 text-end tabular-nums">{qtyText(l.qty, locale)}</td>
                    <td className="py-2.5 text-end tabular-nums" dir="ltr">
                      {money(l.unitPriceMinor)}
                    </td>
                    {showDiscount && (
                      <td className="py-2.5 text-end tabular-nums" dir="ltr">
                        {!l.discount
                          ? '-'
                          : l.discount.kind === 'percent'
                            ? `${percentText(l.discount.bp)}%`
                            : money(l.discount.minor)}
                      </td>
                    )}
                    {showTax && (
                      <td className="py-2.5 text-end tabular-nums">{percentText(l.taxRateBp)}%</td>
                    )}
                    <td className="py-2.5 text-end font-medium tabular-nums" dir="ltr">
                      {money(l.netMinor)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <dl className="ms-auto mt-4 w-full max-w-xs space-y-1.5">
          <div className="flex justify-between gap-4">
            <dt className={MUTED}>{t('subtotal')}</dt>
            <dd className="tabular-nums" dir="ltr">
              {money(doc.subtotalMinor)}
            </dd>
          </div>
          {doc.discountMinor > 0 && (
            <div className="flex justify-between gap-4">
              <dt className={MUTED}>
                {doc.discount?.kind === 'percent'
                  ? t('discountPercent', { percent: percentText(doc.discount.bp) })
                  : t('discountRow')}
              </dt>
              <dd className="tabular-nums" dir="ltr">
                -{money(doc.discountMinor)}
              </dd>
            </div>
          )}
          {doc.taxGroups
            .filter((g) => g.taxMinor > 0)
            .map((g) => (
              <div key={g.rateBp} className="flex justify-between gap-4">
                <dt className={MUTED}>{t('taxRow', { percent: percentText(g.rateBp) })}</dt>
                <dd className="tabular-nums" dir="ltr">
                  {money(g.taxMinor)}
                </dd>
              </div>
            ))}
          <div className="flex justify-between gap-4 border-t-2 border-[#0f172a] pt-2 text-base font-bold">
            <dt>{t('total')}</dt>
            <dd className="tabular-nums" dir="ltr">
              {money(doc.totalMinor)}
            </dd>
          </div>
        </dl>
      </section>

      {doc.notes && (
        <section className="mt-8">
          <Label>{t('notes')}</Label>
          <p className="mt-1.5 whitespace-pre-wrap" dir="auto">
            {doc.notes}
          </p>
        </section>
      )}
      {doc.terms && (
        <section className="mt-6">
          <Label>{t('terms')}</Label>
          <p className={cn('mt-1.5 whitespace-pre-wrap text-[12px]', MUTED)} dir="auto">
            {doc.terms}
          </p>
        </section>
      )}
    </article>
  );
}

/**
 * Prints the paper on its own. The sheet is drawn once more into a node that is a direct child of <body>, hidden on screen;
 * while printing, every other child of <body> is hidden, so the app shell, the menu and the form never reach the page. "Save as
 * PDF" in the print dialog is the PDF.
 */
export function PrintSheet({ doc, zone }: { doc: PaperDoc; zone?: string }) {
  // The node is created on the client only (the server snapshot is null), so hydration sees nothing to compare.
  const host = useSyncExternalStore(subscribeNever, printHost, () => null);
  if (!host) return null;
  return createPortal(
    <>
      <style>{`
        #sd-print-root { display: none; }
        @media print {
          body > *:not(#sd-print-root) { display: none !important; }
          #sd-print-root { display: block !important; background: #fff; }
          #sd-print-root article { box-shadow: none !important; max-width: none !important; padding: 0 !important; }
          @page { margin: 14mm; }
        }
      `}</style>
      <DocumentPaper doc={doc} zone={zone} />
    </>,
    host,
  );
}

const subscribeNever = () => () => undefined;

function printHost(): HTMLElement {
  let el = document.getElementById('sd-print-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sd-print-root';
    document.body.appendChild(el);
  }
  return el;
}

export function printDocument(): void {
  window.print();
}
