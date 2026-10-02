'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { CreditNoteResponse } from '@crm/contracts';
import { Alert, Button, Spinner, cn } from '@crm/ui';
import { useCreditNote } from '../api/hooks';
import { creditNotePdfPath } from '../api/service';
import {
  big,
  creditLineUnitMinor,
  creditNoteActions,
  moneyEffect,
  num,
  taxRowLabel,
} from '../lib/credit-notes';
import { formatDateTime, formatDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { percentLabel } from '../lib/wire';
import {
  BackIcon,
  BanIcon,
  CheckIcon,
  DownloadIcon,
  PencilIcon,
  PrinterIcon,
  TrashIcon,
} from './icons';
import {
  creditNoteEditHref,
  CreditStatusChip,
  SettlementChip,
  useCreditNoteDialogs,
} from './credit-notes-parts';
import { ErrorLine, Money, UserText, useInvoicingCan, useWorkspaceZone } from './parts';

/**
 * `/credit-notes/[id]`: the credit note as a document, what happened to the money (applied to the balance, returned in cash),
 * the invoice after it, and the actions its state allows. `?print=1` opens the print dialog once it has loaded.
 */
export function CreditNoteDetail({ id }: { id: string }) {
  const t = useTranslations('invoicing.creditNotes.detail');
  const router = useRouter();
  const search = useSearchParams();
  const can = useInvoicingCan();
  const q = useCreditNote(id);
  const dialogs = useCreditNoteDialogs({
    onDone: (kind) => kind === 'delete' && router.replace('/credit-notes'),
  });

  const printed = useRef(false);
  const wantsPrint = search.get('print') === '1';
  useEffect(() => {
    if (!wantsPrint || printed.current || !q.data) return;
    printed.current = true;
    const h = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(h);
  }, [wantsPrint, q.data]);

  if (!can.readCreditNotes) {
    return (
      <div className="space-y-3">
        <Alert tone="warning">{t('noAccess')}</Alert>
        <BackLink />
      </div>
    );
  }
  if (q.isPending) {
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="space-y-3">
        <ErrorLine error={q.error} onRetry={() => void q.refetch()} />
        <BackLink />
      </div>
    );
  }

  const n = q.data;
  const target = { id: n.id, number: n.number, rowVersion: n.rowVersion };
  const allowed = creditNoteActions(
    { status: n.status, refundedMinor: num(big(n.refunded, n.currency)) },
    can,
  );
  const refunded = big(n.refunded, n.currency) > 0n;
  const btn =
    'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 print:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/credit-notes"
            aria-label={t('back')}
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <BackIcon className="size-4 rtl:rotate-180" />
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1
                className={cn(
                  'text-xl font-bold tracking-tight',
                  !n.number && 'italic text-muted-foreground',
                )}
                dir="ltr"
              >
                {n.number ?? t('draft')}
              </h1>
              <CreditStatusChip status={n.status} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('againstInvoice')}{' '}
              <Link
                href={`/invoices/${n.invoice.id}`}
                className="font-medium text-primary hover:underline"
                dir="ltr"
              >
                {n.invoice.number ?? t('draft')}
              </Link>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allowed.has('edit') && (
            <Link href={creditNoteEditHref(n.id)} className={btn}>
              <PencilIcon /> {t('edit')}
            </Link>
          )}
          {allowed.has('issue') && (
            <Button onClick={() => dialogs.open('issue', target)} className="h-10">
              <CheckIcon /> {t('issue')}
            </Button>
          )}
          {allowed.has('pdf') && (
            <a href={creditNotePdfPath(n.id)} target="_blank" rel="noopener" className={btn}>
              <DownloadIcon /> {t('pdf')}
            </a>
          )}
          <button type="button" onClick={() => window.print()} className={btn}>
            <PrinterIcon /> {t('print')}
          </button>
          {allowed.has('void') && (
            <Button variant="danger" onClick={() => dialogs.open('void', target)} className="h-10">
              <BanIcon /> {t('void')}
            </Button>
          )}
          {allowed.has('delete') && (
            <Button
              variant="danger"
              onClick={() => dialogs.open('delete', target)}
              className="h-10"
            >
              <TrashIcon /> {t('delete')}
            </Button>
          )}
        </div>
      </header>

      {n.status === 'issued' && refunded && can.voidCreditNote && (
        <Alert tone="info" className="print:hidden">
          {t('cannotVoidRefunded')}
        </Alert>
      )}
      {n.status === 'void' && <VoidInfo note={n} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <CreditPaper note={n} />
        <aside className="min-w-0 space-y-4 print:hidden">
          <MoneyCard note={n} />
          <InvoiceAfterCard note={n} />
        </aside>
      </div>
      {dialogs.node}
    </div>
  );
}

function BackLink() {
  const t = useTranslations('invoicing.creditNotes.detail');
  return (
    <Link href="/credit-notes" className="text-sm text-primary underline underline-offset-2">
      {t('backToList')}
    </Link>
  );
}

function VoidInfo({ note }: { note: CreditNoteResponse }) {
  const t = useTranslations('invoicing.creditNotes.detail');
  const locale = useLocale();
  const zone = useWorkspaceZone();
  return (
    <Alert tone="warning" className="print:hidden">
      <p className="font-medium">
        {note.voidedAt
          ? t('voidedOn', { date: formatDateTime(note.voidedAt, locale, zone) })
          : t('voided')}
      </p>
      {note.voidReason && (
        <p className="mt-1">
          {t('voidReason')}: <UserText>{note.voidReason}</UserText>
        </p>
      )}
    </Alert>
  );
}

function Row({
  label,
  children,
  strong,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 text-sm',
        strong && 'border-t border-border pt-2 font-semibold',
      )}
    >
      <dt className={strong ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

/** "What happened to the money": applied to the invoice's balance and returned in cash; for a draft, what issuing will do. */
function MoneyCard({ note }: { note: CreditNoteResponse }) {
  const t = useTranslations('invoicing.creditNotes.money');
  const c = note.currency;
  const m = (v: bigint) => <Money minor={num(v)} currency={c} />;
  const a = note.invoiceAmounts;
  const body = (() => {
    if (note.status === 'issued') {
      return (
        <dl className="space-y-1.5">
          <Row label={t('total')}>{m(big(note.total, c))}</Row>
          <Row label={t('applied')}>{m(big(note.applied, c))}</Row>
          <Row label={t('refunded')}>{m(big(note.refunded, c))}</Row>
        </dl>
      );
    }
    if (note.status === 'void')
      return <p className="text-sm text-muted-foreground">{t('voidNote')}</p>;
    const e = moneyEffect({
      totalMinor: big(a.total, c),
      creditedMinor: big(a.credited, c),
      paidMinor: big(a.paid, c),
      creditMinor: big(note.total, c),
      settlement: note.settlement,
    });
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('draftNote')}</p>
        <dl className="space-y-1.5">
          <Row label={t('applied')}>{m(e.appliedMinor)}</Row>
          <Row label={t('refunded')}>{m(e.refundMinor)}</Row>
        </dl>
        <p className="text-xs text-muted-foreground">{t('estimate')}</p>
      </div>
    );
  })();
  return (
    <section className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {note.status === 'draft' ? t('titleDraft') : t('title')}
        </h2>
        <SettlementChip settlement={note.settlement} />
      </div>
      <p className="text-sm text-muted-foreground">
        {t(note.settlement === 'refund' ? 'refundBody' : 'balanceBody')}
      </p>
      {body}
    </section>
  );
}

/** The invoice's figures as of this credit note (for a draft: as of now). */
function InvoiceAfterCard({ note }: { note: CreditNoteResponse }) {
  const t = useTranslations('invoicing.creditNotes.after');
  const c = note.currency;
  const a = note.invoiceAmounts;
  const m = (v: string) => <Money minor={num(big(v, c))} currency={c} />;
  const credit = big(a.credit, c);
  return (
    <section className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {note.status === 'draft' ? t('titleNow') : t('title')}
        </h2>
        <Link
          href={`/invoices/${note.invoice.id}`}
          className="text-sm text-primary hover:underline"
          dir="ltr"
        >
          {note.invoice.number}
        </Link>
      </div>
      <dl className="space-y-1.5">
        <Row label={t('total')}>{m(a.total)}</Row>
        <Row label={t('paid')}>{m(a.paid)}</Row>
        <Row label={t('credited')}>{m(a.credited)}</Row>
        <Row label={t('balance')} strong>
          {m(a.balance)}
        </Row>
        {credit > 0n && <Row label={t('credit')}>{m(a.credit)}</Row>}
      </dl>
    </section>
  );
}

/** The credit note as a printed page: always white with dark text, like paper; the only thing that prints. */
function CreditPaper({ note: n }: { note: CreditNoteResponse }) {
  const t = useTranslations('invoicing.creditNotes.paper');
  const locale = useLocale();
  const c = n.currency;
  const money = (v: bigint | string) =>
    formatMoney(num(typeof v === 'string' ? big(v, c) : v), c, locale);
  const seller = n.seller;
  const stamp = n.status === 'void';
  return (
    <>
      <style>{PRINT_CSS}</style>
      <article
        aria-label={n.number ? t('label', { number: n.number }) : t('labelDraft')}
        className="credit-paper relative min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-900 shadow-sm sm:p-8"
      >
        {stamp && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute end-6 top-24 rotate-[-12deg] rounded-md border-4 border-slate-500 px-4 py-1 text-3xl font-extrabold uppercase tracking-widest text-slate-500 opacity-25 sm:text-4xl rtl:rotate-[12deg]"
          >
            {t('void')}
          </div>
        )}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-base font-semibold" dir="auto">
              {seller?.name || t('sellerFallback')}
            </div>
            {seller?.address && (
              <div className="mt-0.5 whitespace-pre-line text-slate-600" dir="auto">
                {seller.address}
              </div>
            )}
            {seller?.taxId && (
              <div className="mt-0.5 text-slate-600" dir="auto">
                {seller.taxId}
              </div>
            )}
            {seller?.extra.map((x) => (
              <div key={x.label} className="text-slate-600" dir="auto">
                {x.label}: {x.value}
              </div>
            ))}
          </div>
          <div className="text-end">
            <div className="text-2xl font-bold uppercase tracking-wide text-slate-800">
              {t('title')}
            </div>
            <div className="mt-1 font-mono text-slate-600" dir="ltr">
              {n.number ?? t('draftNumber')}
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t('creditedTo')}
            </div>
            <div className="mt-1 font-medium" dir="auto">
              {n.buyerName || t('buyerFallback')}
            </div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 sm:justify-self-end">
            <dt className="text-slate-500">{t('issued')}</dt>
            <dd className="text-end font-medium">{formatDay(n.issueDate, locale) || '-'}</dd>
            <dt className="text-slate-500">{t('invoice')}</dt>
            <dd className="text-end font-medium" dir="ltr">
              {n.invoice.number ?? '-'}
            </dd>
          </dl>
        </section>

        <div className="thin-scrollbar mt-6 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-300 text-[11px] uppercase tracking-wider text-slate-500">
                <th scope="col" className="py-2 pe-2 text-start font-semibold">
                  {t('item')}
                </th>
                <th scope="col" className="px-2 py-2 text-end font-semibold">
                  {t('qty')}
                </th>
                <th scope="col" className="px-2 py-2 text-end font-semibold">
                  {t('unit')}
                </th>
                <th scope="col" className="px-2 py-2 text-end font-semibold">
                  {t('tax')}
                </th>
                <th scope="col" className="px-2 py-2 text-end font-semibold">
                  {t('net')}
                </th>
                <th scope="col" className="px-2 py-2 text-end font-semibold">
                  {t('taxAmount')}
                </th>
                <th scope="col" className="py-2 ps-2 text-end font-semibold">
                  {t('total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {n.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-200 align-top">
                  <td className="py-2 pe-2" dir="auto">
                    {l.description}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums">{l.qty}</td>
                  <td className="px-2 py-2 text-end tabular-nums" dir="ltr">
                    {money(creditLineUnitMinor(l.amounts.net, l.qty, c))}
                  </td>
                  <td className="px-2 py-2 text-end text-xs text-slate-500">
                    {Number(l.taxRate) > 0
                      ? `${l.taxName ?? t('taxFallback')} ${percentLabel(l.taxRate)}%`
                      : '-'}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums" dir="ltr">
                    {money(l.amounts.net)}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums" dir="ltr">
                    {money(l.amounts.tax)}
                  </td>
                  <td className="py-2 ps-2 text-end font-medium tabular-nums" dir="ltr">
                    {money(l.amounts.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-4 flex flex-col items-end gap-4">
          {n.taxSummary.length > 0 && (
            <div className="w-full max-w-md">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {t('taxSummary')}
              </div>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-300 text-slate-500">
                    <th scope="col" className="py-1 pe-2 text-start font-medium">
                      {t('taxRate')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-end font-medium">
                      {t('taxBase')}
                    </th>
                    <th scope="col" className="py-1 ps-2 text-end font-medium">
                      {t('taxAmount')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {n.taxSummary.map((g) => (
                    <tr
                      key={`${g.name}-${g.rate}-${g.inclusive}`}
                      className="border-b border-slate-100"
                    >
                      <td className="py-1 pe-2" dir="auto">
                        {taxRowLabel(g.name, percentLabel(g.rate))}
                        {g.inclusive ? ` (${t('included')})` : ''}
                      </td>
                      <td className="px-2 py-1 text-end tabular-nums" dir="ltr">
                        {money(g.base)}
                      </td>
                      <td className="py-1 ps-2 text-end tabular-nums" dir="ltr">
                        {money(g.tax)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <dl className="w-full max-w-xs space-y-1.5">
            <PaperRow label={t('subtotal')} value={money(n.amounts.subtotal)} />
            <PaperRow label={t('taxTotal')} value={money(n.amounts.tax)} />
            <div className="flex items-baseline justify-between gap-4 border-t-2 border-slate-300 pt-2 text-base font-bold">
              <dt>{t('totalCredit')}</dt>
              <dd dir="ltr" className="tabular-nums">
                {money(n.amounts.total)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-6 grid gap-4 border-t border-slate-200 pt-4 text-xs text-slate-600 sm:grid-cols-2">
          <div>
            <div className="mb-1 font-semibold uppercase tracking-wider text-slate-500">
              {t('reason')}
            </div>
            <ReasonChipPaper reason={n.reason} />
          </div>
          {n.note && (
            <div>
              <div className="mb-1 font-semibold uppercase tracking-wider text-slate-500">
                {t('note')}
              </div>
              <p className="whitespace-pre-line" dir="auto">
                {n.note}
              </p>
            </div>
          )}
        </section>
      </article>
    </>
  );
}

/** The reason in words, in the paper's own (non-themed) colours. */
function ReasonChipPaper({ reason }: { reason: CreditNoteResponse['reason'] }) {
  const t = useTranslations('invoicing.creditNotes.reasons');
  return <span className="text-sm font-medium text-slate-800">{t(reason)}</span>;
}

function PaperRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-600">{label}</dt>
      <dd dir="ltr" className="tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/** Only the paper prints: everything else (menu, buttons, other panels) is hidden. */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .credit-paper, .credit-paper * { visibility: visible !important; }
  .credit-paper { position: absolute !important; inset: 0 auto auto 0 !important; width: 100% !important; max-width: none !important; border: 0 !important; box-shadow: none !important; border-radius: 0 !important; overflow: visible !important; }
  @page { margin: 12mm; }
}`;
