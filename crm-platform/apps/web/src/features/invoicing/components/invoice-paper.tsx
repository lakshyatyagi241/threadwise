'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { formatDay, formatDateTime } from '../lib/dates';
import { formatMoney } from '../lib/money';
import type { PaperModel } from '../lib/paper';
import { qtyText } from '../lib/totals';

/**
 * The invoice as a printed page. It is always white with dark text, like paper, in light and dark mode, and it is the only
 * thing that prints (see `.invoice-print` in the page that hosts it). The same component draws the builder's live preview, the
 * staff view and the buyer's page: the seller block (name, address, tax id, registration, statutory fields), the buyer block, the
 * document title, the lines (with an HSN/SAC column where the seller's country asks for one), the tax summary per rate, the
 * reverse-charge and legal notes, the payments received and the balance, then notes, terms, bank details and the footer.
 */
export function InvoicePaper({ model: m, className }: { model: PaperModel; className?: string }) {
  const t = useTranslations('invoicing.paper');
  const ts = useTranslations('invoicing.status');
  const tm = useTranslations('invoicing.method');
  const locale = useLocale();
  const money = (n: number) => formatMoney(n, m.currency, locale);
  const stamp = m.status === 'paid' ? 'paid' : m.status === 'void' ? 'void' : null;
  const brand = m.brandColor && /^#[0-9A-Fa-f]{6}$/.test(m.brandColor) ? m.brandColor : null;
  const title = m.title || t(`docTitle.${m.docType}`);
  const cols = 4 + (m.showHsn ? 1 : 0);
  const exclusive = m.taxRows.filter((r) => !r.inclusive);
  const showBalance =
    (m.paidMinor > 0 || m.creditedMinor > 0 || m.status === 'paid') && m.status !== 'void';
  const s = m.seller;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <article
        aria-label={m.number ? t('label', { number: m.number }) : t('labelDraft')}
        style={brand ? { borderTop: `4px solid ${brand}` } : undefined}
        className={cn(
          'invoice-paper relative overflow-hidden rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-900 shadow-sm sm:p-8',
          className,
        )}
      >
        {stamp && (
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute end-6 top-24 rotate-[-12deg] rounded-md border-4 px-4 py-1 text-3xl font-extrabold uppercase tracking-widest opacity-25 sm:text-4xl rtl:rotate-[12deg]',
              stamp === 'paid'
                ? 'border-green-700 text-green-700'
                : 'border-slate-500 text-slate-500',
            )}
          >
            {ts(stamp)}
          </div>
        )}

        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {s?.logoUrl && s.logoUrl.startsWith('https://') && (
              <img src={s.logoUrl} alt="" className="mb-2 max-h-12 w-auto" />
            )}
            <div className="text-base font-semibold" dir="auto">
              {s?.name || t('sellerFallback')}
            </div>
            {s?.address && (
              <div className="mt-0.5 whitespace-pre-line text-slate-600" dir="auto">
                {s.address}
              </div>
            )}
            {(s?.phone || s?.email) && (
              <div className="mt-0.5 text-slate-600" dir="ltr">
                {[s.phone, s.email].filter(Boolean).join(' / ')}
              </div>
            )}
            {s?.taxId && (
              <div className="mt-0.5 text-slate-600">
                {t('sellerTaxId')}: <span dir="ltr">{s.taxId}</span>
              </div>
            )}
            {s?.registrationNo && (
              <div className="text-slate-600">
                {t('registrationNo')}: <span dir="ltr">{s.registrationNo}</span>
              </div>
            )}
            {s?.extra.map((f) => (
              <div key={`${f.label}-${f.value}`} className="text-slate-600" dir="auto">
                {f.label}: {f.value}
              </div>
            ))}
          </div>
          <div className="text-end">
            <div className="text-2xl font-bold uppercase tracking-wide text-slate-800" dir="auto">
              {title}
            </div>
            <div className="mt-1 font-mono text-slate-600" dir="ltr">
              {m.number ?? t('draftNumber')}
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t('billedTo')}
            </div>
            <div className="mt-1 font-medium" dir="auto">
              {m.buyer.name || t('buyerFallback')}
            </div>
            {m.buyer.address && (
              <div className="whitespace-pre-line text-slate-600" dir="auto">
                {m.buyer.address}
              </div>
            )}
            {m.buyer.email && (
              <div className="text-slate-600" dir="ltr">
                {m.buyer.email}
              </div>
            )}
            {m.buyer.phone && (
              <div className="text-slate-600" dir="ltr">
                {m.buyer.phone}
              </div>
            )}
            {m.buyer.taxId && (
              <div className="text-slate-600">
                {t('buyerTaxId')}: <span dir="ltr">{m.buyer.taxId}</span>
              </div>
            )}
          </div>
          <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 sm:justify-self-end">
            <dt className="text-slate-500">{t('issued')}</dt>
            <dd className="text-end font-medium">{formatDay(m.issueDate, locale) || '-'}</dd>
            <dt className="text-slate-500">{t('due')}</dt>
            <dd className={cn('text-end font-medium', m.status === 'overdue' && 'text-red-700')}>
              {formatDay(m.dueDate, locale) || t('onReceipt')}
            </dd>
            {m.reference && (
              <>
                <dt className="text-slate-500">{t('reference')}</dt>
                <dd className="text-end font-medium" dir="auto">
                  {m.reference}
                </dd>
              </>
            )}
            {m.placeOfSupply && (
              <>
                <dt className="text-slate-500">{t('placeOfSupply')}</dt>
                <dd className="text-end font-medium" dir="ltr">
                  {m.placeOfSupply}
                </dd>
              </>
            )}
          </dl>
        </section>

        <div className="thin-scrollbar mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-300 text-[11px] uppercase tracking-wider text-slate-500">
                <th scope="col" className="py-2 pe-2 text-start font-semibold">
                  {t('item')}
                </th>
                {m.showHsn && (
                  <th scope="col" className="px-2 py-2 text-start font-semibold">
                    {t('hsn')}
                  </th>
                )}
                <th scope="col" className="px-2 py-2 text-end font-semibold">
                  {t('qty')}
                </th>
                <th scope="col" className="px-2 py-2 text-end font-semibold">
                  {t('price')}
                </th>
                <th scope="col" className="hidden px-2 py-2 text-end font-semibold sm:table-cell">
                  {t('tax')}
                </th>
                <th scope="col" className="py-2 ps-2 text-end font-semibold">
                  {t('amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {m.lines.length === 0 && (
                <tr>
                  <td colSpan={cols + 1} className="py-6 text-center text-slate-400">
                    {t('noLines')}
                  </td>
                </tr>
              )}
              {m.lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-200 align-top">
                  <td className="py-2 pe-2" dir="auto">
                    {l.description || <span className="text-slate-400">{t('noDescription')}</span>}
                    {l.sku && <div className="text-xs text-slate-500">{l.sku}</div>}
                    {l.taxLabel && (
                      <div className="text-xs text-slate-500 sm:hidden">{l.taxLabel}</div>
                    )}
                    {l.discount && (
                      <div className="text-xs text-slate-500">
                        {l.discount.kind === 'percent'
                          ? t('lineDiscount', { percent: l.discount.percent })
                          : t('lineDiscountAmount', { amount: money(l.discount.amountMinor) })}
                      </div>
                    )}
                  </td>
                  {m.showHsn && (
                    <td className="px-2 py-2 text-start text-xs text-slate-600" dir="ltr">
                      {l.hsnSac ?? '-'}
                    </td>
                  )}
                  <td className="px-2 py-2 text-end tabular-nums">{qtyText(l.qty, locale)}</td>
                  <td className="px-2 py-2 text-end tabular-nums" dir="ltr">
                    {money(l.unitPriceMinor)}
                  </td>
                  <td
                    className="hidden px-2 py-2 text-end text-xs text-slate-500 sm:table-cell"
                    dir="auto"
                  >
                    {l.taxLabel ?? '-'}
                  </td>
                  <td className="py-2 ps-2 text-end font-medium tabular-nums" dir="ltr">
                    {money(l.amountMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-4 flex justify-end">
          <dl className="w-full max-w-xs space-y-1.5">
            <Row label={t('subtotal')} value={money(m.subtotalMinor)} />
            {m.discountMinor > 0 && (
              <Row
                label={
                  m.discountPercent !== null
                    ? t('discountPercent', { percent: m.discountPercent })
                    : t('discount')
                }
                value={`-${money(m.discountMinor)}`}
              />
            )}
            {exclusive.map((r) => (
              <Row key={`${r.label}-${r.baseMinor}`} label={r.label} value={money(r.taxMinor)} />
            ))}
            {m.shippingMinor > 0 && <Row label={t('shipping')} value={money(m.shippingMinor)} />}
            <div className="flex items-baseline justify-between gap-4 border-t-2 border-slate-300 pt-2 text-base font-bold">
              <dt>{t('total')}</dt>
              <dd dir="ltr" className="tabular-nums">
                {money(m.totalMinor)}
              </dd>
            </div>
            {m.includedTaxMinor > 0 && (
              <Row muted label={t('includesTax')} value={money(m.includedTaxMinor)} />
            )}
            {m.creditedMinor > 0 && (
              <Row label={t('credited')} value={`-${money(m.creditedMinor)}`} />
            )}
            {m.paidMinor > 0 && <Row label={t('paid')} value={`-${money(m.paidMinor)}`} />}
            {showBalance && (
              <div className="flex items-baseline justify-between gap-4 rounded bg-slate-100 px-2 py-1.5 font-bold">
                <dt>{t('balanceDue')}</dt>
                <dd dir="ltr" className="tabular-nums">
                  {money(m.balanceMinor)}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {m.taxRows.length > 0 && (
          <section aria-label={t('taxSummary')} className="mt-5">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t('taxSummary')}
            </div>
            <div className="thin-scrollbar overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-300 text-slate-500">
                    <th scope="col" className="py-1 pe-2 text-start font-medium">
                      {t('taxName')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-end font-medium">
                      {t('taxBase')}
                    </th>
                    <th scope="col" className="ps-2 py-1 text-end font-medium">
                      {t('taxAmount')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {m.taxRows.map((r) => (
                    <tr
                      key={`${r.label}-${r.inclusive}-${r.baseMinor}`}
                      className="border-b border-slate-100"
                    >
                      <td className="py-1 pe-2" dir="auto">
                        {r.label}
                        {r.inclusive && (
                          <span className="text-slate-500"> ({t('taxInclusive')})</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-end tabular-nums" dir="ltr">
                        {money(r.baseMinor)}
                      </td>
                      <td className="ps-2 py-1 text-end tabular-nums" dir="ltr">
                        {money(r.taxMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {(m.reverseCharge || m.legalNotes) && (
          <section className="mt-4 space-y-1 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            {m.reverseCharge && <p className="font-semibold">{t('reverseCharge')}</p>}
            {m.legalNotes && (
              <p className="whitespace-pre-line" dir="auto">
                {m.legalNotes}
              </p>
            )}
          </section>
        )}

        {m.payments.length > 0 && (
          <section aria-label={t('paymentsReceived')} className="mt-5">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t('paymentsReceived')}
            </div>
            <ul className="divide-y divide-slate-100 text-xs">
              {m.payments.map((p, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1">
                  <span>
                    {formatDateTime(p.paidAt, locale)} -{' '}
                    {tm.has(p.method) ? tm(p.method) : p.method}
                    {p.kind === 'refund' && ` (${t('refund')})`}
                    {p.receiptNumber && <span dir="ltr"> - {p.receiptNumber}</span>}
                  </span>
                  <span dir="ltr" className="tabular-nums">
                    {p.kind === 'refund' ? '-' : ''}
                    {money(Math.abs(p.amountMinor))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(m.notes || m.terms) && (
          <section className="mt-6 grid gap-4 border-t border-slate-200 pt-4 text-xs text-slate-600 sm:grid-cols-2">
            {m.notes && (
              <div>
                <div className="mb-1 font-semibold uppercase tracking-wider text-slate-500">
                  {t('notes')}
                </div>
                <p className="whitespace-pre-line" dir="auto">
                  {m.notes}
                </p>
              </div>
            )}
            {m.terms && (
              <div>
                <div className="mb-1 font-semibold uppercase tracking-wider text-slate-500">
                  {t('terms')}
                </div>
                <p className="whitespace-pre-line" dir="auto">
                  {m.terms}
                </p>
              </div>
            )}
          </section>
        )}

        {s?.bankDetails && (
          <section aria-label={t('bankDetails')} className="mt-4 text-xs text-slate-600">
            <div className="mb-1 font-semibold uppercase tracking-wider text-slate-500">
              {t('bankDetails')}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              {Object.entries(s.bankDetails).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500" dir="auto">
                    {k}
                  </dt>
                  <dd dir="auto">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {m.status === 'void' && m.voidReason && (
          <p className="mt-4 text-xs text-slate-500" dir="auto">
            {t('voidReason', { reason: m.voidReason })}
          </p>
        )}
        {m.footerNote && (
          <p
            className="mt-6 whitespace-pre-line border-t border-slate-200 pt-3 text-center text-xs text-slate-500"
            dir="auto"
          >
            {m.footerNote}
          </p>
        )}
      </article>
    </>
  );
}

/** Only the paper prints: everything else (menu, buttons, other panels) is hidden, and the page margins are the paper's. */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .invoice-paper, .invoice-paper * { visibility: visible !important; }
  .invoice-paper { position: absolute !important; inset: 0 auto auto 0 !important; width: 100% !important; max-width: none !important; border: 0 !important; box-shadow: none !important; border-radius: 0 !important; overflow: visible !important; }
  @page { margin: 12mm; }
}`;

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      className={cn('flex items-baseline justify-between gap-4', muted && 'text-xs text-slate-500')}
    >
      <dt className={muted ? undefined : 'text-slate-600'} dir="auto">
        {label}
      </dt>
      <dd dir="ltr" className="tabular-nums">
        {value}
      </dd>
    </div>
  );
}
