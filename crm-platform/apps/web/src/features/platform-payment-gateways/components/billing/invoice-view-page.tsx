'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { InvoiceView } from '@crm/contracts';
import { Button, cn } from '@crm/ui';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { BILLING_KEYS, billingApi } from '../../billing-api';
import { capitalize, money } from '../../lib/billing-format';
import { InvoiceBadge } from './invoices-page';
import { Crumb } from './parts';

const NS = 'platform-payment-gateways.billing.invoice';

/** Hides the console around the invoice and sets the page for A4, so Print and "Download PDF" give one clean document. */
const PRINT_CSS = `
@media print {
  @page { margin: 10mm; size: A4; }
  html, body { background: #fff !important; color: #000 !important; }
  body * { visibility: hidden !important; }
  .invoice-doc, .invoice-doc * { visibility: visible !important; }
  .invoice-doc { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important;
    max-width: 100% !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
  .no-print { display: none !important; }
}`;

const fmtDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
const fmtDateTime = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(iso));

/** Admin > Invoices > one invoice (TW-PAYGW-046): a tax-invoice document that prints to A4 or PDF from the browser. */
export function InvoiceViewPage({ id }: { id: string }) {
  const ti = useTranslations('platform-payment-gateways.billing.invoices');
  const q = useQuery({
    queryKey: BILLING_KEYS.invoice(id),
    queryFn: ({ signal }) => billingApi.invoice(id, signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <InvoiceDocument
      v={q.data}
      crumb={[{ label: ti('title'), href: '/admin/invoices' }, { label: q.data.number }]}
    />
  );
}

/** What the printable document needs. The buyer's copy has no gateway name (Reference hides it), so method and currency are optional. */
export type InvoiceDocumentView = Omit<
  InvoiceView,
  'workspace' | 'gatewaySlug' | 'manual' | 'payment'
> & {
  payment: {
    method?: string;
    reference: string | null;
    paidAt: string | null;
    currency?: string;
    couponCode: string | null;
  };
  /** The buyer's footer line "refunds within N days"; absent on the operator's copy. */
  refundDays?: number | null;
};

/** The tax-invoice document itself, shared by the operator's view and the buyer's own copy (TW-PAYGW-046, 036). */
export function InvoiceDocument({
  v,
  crumb,
}: {
  v: InvoiceDocumentView;
  crumb: Array<{ label: string; href?: string }>;
}) {
  const t = useTranslations(NS);
  const ti = useTranslations('platform-payment-gateways.billing.invoices');
  const locale = useLocale();
  const m = (a: string) => money(a, v.currency, locale);
  const billTo = v.billTo;
  const hasDiscount = Number(v.discount) > 0;
  const hasTax = Number(v.taxAmount) > 0 || Number(v.taxRate) > 0;
  const badgeLabel = ti(`badges.${v.badge}`);

  return (
    <div className="space-y-5">
      <style>{PRINT_CSS}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Crumb items={crumb} />
        <div className="flex flex-wrap items-center gap-2">
          <InvoiceBadge
            badge={v.badge}
            label={`${badgeLabel}${v.paidAt ? ` · ${v.paidAt.slice(0, 10)}` : ''}`}
          />
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={() => window.print()}
          >
            {t('print')}
          </Button>
          <Button size="sm" className="rounded-full" onClick={() => window.print()}>
            {t('downloadPdf')}
          </Button>
        </div>
      </div>

      <div className="no-print flex flex-col gap-4 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('banner.invoice', { number: v.number })}
            {v.payment.method ? ` · ${v.payment.method}` : ''}
            {v.payment.reference ? ` · ${v.payment.reference}` : ''}
          </div>
          <div className="mt-0.5 text-lg font-semibold leading-tight">
            {billTo.name ?? '—'} · {v.line.description}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t('banner.issued', { date: v.issuedAt.slice(0, 10) })}
            {v.paidAt ? ` · ${t('banner.settled', { date: v.paidAt.slice(0, 10) })}` : ''}
          </div>
        </div>
        <div className="text-end">
          <div className="text-2xl font-semibold leading-none text-primary">{m(v.total)}</div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
            {v.currency} · {v.status === 'paid' ? t('banner.paidInFull') : capitalize(v.status)}
          </div>
        </div>
      </div>

      <article className="invoice-doc mx-auto max-w-[860px] overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-sm">
        <header className="border-b border-border px-5 pb-6 pt-10 sm:px-10">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row">
            <div>
              {v.billing.logoUrl ? (
                // The uploaded invoice logo already carries the brand, so the company name is not repeated beside it.
                <img
                  src={v.billing.logoUrl}
                  alt={v.billing.company}
                  className="max-h-14 max-w-[240px] object-contain"
                />
              ) : (
                <span className="text-2xl font-semibold leading-none">{v.billing.company}</span>
              )}
              <div className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                {v.billing.address && (
                  <div className="whitespace-pre-line">{v.billing.address}</div>
                )}
                {v.billing.taxId && (
                  <div>
                    {t('taxIdLabel')} <span className="font-mono">{v.billing.taxId}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="text-end">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {t('taxInvoice')}
              </div>
              <h1 className="mt-1 text-4xl font-semibold leading-none">{t('invoiceWord')}</h1>
              <dl className="mt-3 grid grid-cols-[auto_auto] justify-end gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t('number')}</dt>
                <dd className="font-mono font-semibold">{v.number}</dd>
                <dt className="text-muted-foreground">{t('issueDate')}</dt>
                <dd className="font-mono">{fmtDate(v.issuedAt, locale)}</dd>
                {v.paidAt && (
                  <>
                    <dt className="text-muted-foreground">{t('paidDate')}</dt>
                    <dd className="font-mono">{fmtDate(v.paidAt, locale)}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">{t('status')}</dt>
                <dd>
                  <InvoiceBadge badge={v.badge} label={badgeLabel} />
                </dd>
              </dl>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6 border-b border-border px-5 py-6 sm:grid-cols-2 sm:px-10">
          <div>
            <h2 className="mb-2 font-mono text-[10px] font-normal uppercase tracking-[0.18em] text-muted-foreground">
              {t('billTo')}
            </h2>
            <div className="text-sm font-semibold">{billTo.name ?? '—'}</div>
            <div className="mt-1 text-xs leading-relaxed">
              {billTo.email && <div>{billTo.email}</div>}
              {billTo.addressLines.map((l) => (
                <div key={l}>{l}</div>
              ))}
              {billTo.taxId && (
                <div>
                  {t('taxIdLabel')} <span className="font-mono">{billTo.taxId}</span>
                </div>
              )}
            </div>
          </div>
          <div>
            <h2 className="mb-2 font-mono text-[10px] font-normal uppercase tracking-[0.18em] text-muted-foreground">
              {t('payment')}
            </h2>
            <dl className="grid grid-cols-[auto_auto] justify-start gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t('method')}</dt>
              <dd>{v.payment.method ?? '-'}</dd>
              {v.payment.reference && (
                <>
                  <dt className="text-muted-foreground">{t('txn')}</dt>
                  <dd className="font-mono">{v.payment.reference}</dd>
                </>
              )}
              {v.payment.paidAt && (
                <>
                  <dt className="text-muted-foreground">{t('captured')}</dt>
                  <dd className="font-mono">{fmtDateTime(v.payment.paidAt, locale)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{t('currency')}</dt>
              <dd>{v.payment.currency ?? v.currency}</dd>
              {v.payment.couponCode && (
                <>
                  <dt className="text-muted-foreground">{t('coupon')}</dt>
                  <dd className="font-mono">{v.payment.couponCode}</dd>
                </>
              )}
            </dl>
          </div>
        </section>

        <section className="px-5 py-6 sm:px-10">
          <div className="thin-scrollbar overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead>
                <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th scope="col" className="py-2.5 text-start font-normal">
                    {t('description')}
                  </th>
                  <th scope="col" className="w-[80px] py-2.5 text-end font-normal">
                    {t('qty')}
                  </th>
                  <th scope="col" className="w-[120px] py-2.5 text-end font-normal">
                    {t('unit')}
                  </th>
                  <th scope="col" className="w-[120px] py-2.5 text-end font-normal">
                    {t('total')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="py-3">
                    <div className="font-semibold">{v.line.description}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {v.line.reference}
                      {v.line.unit ? ` · ${v.line.unit}` : ''}
                    </div>
                  </td>
                  <td className="py-3 text-end font-mono">1</td>
                  <td className="py-3 text-end font-mono">{m(v.subtotal)}</td>
                  <td className="py-3 text-end font-mono">{m(v.subtotal)}</td>
                </tr>
                {hasDiscount && (
                  <tr>
                    <td className="py-3">
                      <div className="font-semibold">{t('discount')}</div>
                      {v.payment.couponCode && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {t('code')} <span className="font-mono">{v.payment.couponCode}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-end font-mono">1</td>
                    <td className="py-3 text-end font-mono text-danger">-{m(v.discount)}</td>
                    <td className="py-3 text-end font-mono text-danger">-{m(v.discount)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex justify-end">
            <dl className="w-full max-w-[300px] space-y-1.5 text-sm">
              <Row label={t('subtotal')} value={m(v.subtotal)} />
              {hasDiscount && (
                <Row label={t('discount')} value={`-${m(v.discount)}`} tone="danger" />
              )}
              {hasTax && <Row label={`${v.taxLabel} (${v.taxRate}%)`} value={m(v.taxAmount)} />}
              <div className="mt-1 border-t border-border pt-2">
                <Row label={t('total')} value={m(v.total)} strong />
              </div>
              <Row label={t('amountPaid')} value={m(v.amountPaid)} tone="success" />
              <div className="mt-1 border-t border-border pt-2">
                <Row
                  label={t('balanceDue')}
                  value={m(v.balanceDue)}
                  strong
                  tone={Number(v.balanceDue) > 0 ? 'danger' : 'success'}
                />
              </div>
            </dl>
          </div>
        </section>

        <footer className="border-t border-border bg-muted/40 px-5 py-6 sm:px-10">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <h2 className="mb-2 font-mono text-[10px] font-normal uppercase tracking-[0.18em] text-muted-foreground">
                {t('notes')}
              </h2>
              <p className="text-xs leading-relaxed">{t('notesText')}</p>
              {typeof v.refundDays === 'number' && (
                <p className="mt-2 text-xs leading-relaxed">
                  {t('refundNote', { days: v.refundDays })}
                </p>
              )}
            </div>
            <div>
              <h2 className="mb-2 font-mono text-[10px] font-normal uppercase tracking-[0.18em] text-muted-foreground">
                {t('help')}
              </h2>
              <p className="text-xs leading-relaxed">
                {v.billing.email || v.billing.phone ? (
                  <>
                    {v.billing.email}
                    {v.billing.email && v.billing.phone ? ' · ' : ''}
                    {v.billing.phone}
                  </>
                ) : (
                  t('helpFallback')
                )}
              </p>
            </div>
          </div>
          <p className="mt-6 border-t border-border pt-4 text-center text-[11px] text-muted-foreground">
            {v.billing.company}
            {v.billing.regNo ? ` · ${t('regNo')} ${v.billing.regNo}` : ''} ·{' '}
            {t('computerGenerated')}
          </p>
        </footer>
      </article>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'success';
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={cn(strong ? 'font-semibold' : 'text-muted-foreground')}>{label}</dt>
      <dd
        className={cn(
          'font-mono',
          strong && 'text-base font-semibold',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
