'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '@crm/ui';
import { useInvoice, useInvoiceSettings } from '../api/hooks';
import { formatDateTime } from '../lib/dates';
import { actionFacts } from '../lib/invoice-facts';
import { paperFromInvoice } from '../lib/paper';
import { allowedActions } from '../lib/status';
import {
  BackIcon,
  BanIcon,
  CheckIcon,
  CopyDocIcon,
  CopyIcon,
  DownloadIcon,
  NoteIcon,
  PaymentIcon,
  PencilIcon,
  PrinterIcon,
  RefreshIcon,
  SendIcon,
  TrashIcon,
} from './icons';
import { EditDetailsDialog } from './invoice-dialogs';
import { creditNoteHref } from './invoice-menu';
import { InvoicePaper } from './invoice-paper';
import { CreditNotesCard, DetailsCard, SummaryCards } from './invoice-side-cards';
import { ActivityTimeline, PaymentsSection } from './payments-section';
import { ContactPill, ErrorLine, StatusChip, useInvoicingCan, useWorkspaceZone } from './parts';
import { PublicLinkCard, linkStateOf } from './public-link-card';
import { TaxWhy } from './tax-why';
import { linkIsLive, useInvoiceActions } from './use-invoice-actions';
import { useInvoiceDialogs } from './use-invoice-dialogs';

/**
 * `/invoices/[id]`: the invoice as the buyer will see it, what is owed, the public link, the payments with their refunds, the
 * credit notes against it, and the timeline. Every action the invoice's state allows is a button here (the same rules as the
 * row menu). `?print=1` opens the print dialog once the invoice has loaded; only the paper is printed.
 */
export function InvoiceDetail({ id }: { id: string }) {
  const t = useTranslations('invoicing.detail');
  const locale = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const can = useInvoicingCan();
  const zone = useWorkspaceZone();
  const actions = useInvoiceActions();
  const dialogs = useInvoiceDialogs({ onDeleted: () => router.replace('/invoices') });
  const inv = useInvoice(id);
  // A draft has no frozen seller block; it prints from the live business profile (like the builder preview).
  const profile = useInvoiceSettings();
  const [editing, setEditing] = useState(false);

  const printed = useRef(false);
  const wantsPrint = search.get('print') === '1';
  useEffect(() => {
    if (!wantsPrint || printed.current || !inv.data) return;
    printed.current = true;
    const h = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(h);
  }, [wantsPrint, inv.data]);

  const invoice = inv.data;
  if (inv.isPending) {
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (inv.isError || !invoice) {
    return (
      <div className="space-y-3">
        <ErrorLine error={inv.error} onRetry={() => void inv.refetch()} />
        <Link href="/invoices" className="text-sm text-primary underline underline-offset-2">
          {t('backToList')}
        </Link>
      </div>
    );
  }

  const link = invoice.publicLink;
  const allowed = allowedActions(actionFacts(invoice, linkIsLive(link)), { can });
  const issued = invoice.status !== 'draft';
  const open = issued && invoice.status !== 'void';
  const late = invoice.status === 'overdue' ? (invoice.daysOverdue ?? 0) : 0;
  const danger = 'border-danger text-danger hover:bg-danger/10';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Link
            href="/invoices"
            aria-label={t('backToList')}
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted"
          >
            <BackIcon className="rtl:rotate-180" />
          </Link>
          <h1 className="text-xl font-bold tracking-tight" dir="ltr">
            {invoice.number ?? t('draftTitle')}
          </h1>
          <StatusChip status={invoice.status} />
          {late > 0 && <span className="text-xs font-medium text-danger">{t('daysLate', { count: late })}</span>}
          {(invoice.buyerName ?? invoice.contact?.name) && (
            invoice.contact ? (
              <ContactPill contact={{ id: invoice.contact.id, name: invoice.buyerName ?? invoice.contact.name }} />
            ) : (
              <span className="truncate text-sm text-muted-foreground" dir="auto">
                {invoice.buyerName}
              </span>
            )
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allowed.has('edit') && (
            <Link href={`/invoices/${invoice.id}/edit`} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted">
              <PencilIcon /> {t('edit')}
            </Link>
          )}
          {open && can.update && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <PencilIcon /> {t('editDetails')}
            </Button>
          )}
          {allowed.has('issue') && (
            <Button variant="brand" onClick={() => dialogs.open('send', invoice)}>
              <SendIcon /> {t('issueAndSend')}
            </Button>
          )}
          {allowed.has('send') && (
            <Button variant={invoice.sentAt ? 'secondary' : 'brand'} onClick={() => dialogs.open('send', invoice)}>
              <SendIcon /> {invoice.sentAt ? t('shareAgain') : t('send')}
            </Button>
          )}
          {allowed.has('recordPayment') && (
            <Button variant={invoice.sentAt ? 'brand' : 'secondary'} onClick={() => dialogs.open('pay', invoice)}>
              <PaymentIcon /> {t('recordPayment')}
            </Button>
          )}
          {allowed.has('markPaid') && (
            <Button variant="secondary" onClick={() => dialogs.open('markPaid', invoice)}>
              <CheckIcon /> {t('markPaid')}
            </Button>
          )}
          {allowed.has('copyLink') && (
            <Button variant="secondary" onClick={() => void actions.copyLink(invoice, link ?? null)}>
              <CopyIcon /> {t('copyLink')}
            </Button>
          )}
          <Button variant="secondary" onClick={() => window.print()}>
            <PrinterIcon /> {t('print')}
          </Button>
          {issued && (
            <Button variant="secondary" onClick={() => actions.downloadPdf(invoice)}>
              <DownloadIcon /> {t('downloadPdf')}
            </Button>
          )}
          {allowed.has('creditNote') && (
            <Link href={creditNoteHref(invoice.id)} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted">
              <NoteIcon /> {t('createCreditNote')}
            </Link>
          )}
          {can.createRecurring && invoice.status !== 'void' && (
            <Link
              href={`/recurring-invoices/new?fromInvoice=${invoice.id}`}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              <RefreshIcon /> {t('makeRecurring')}
            </Link>
          )}
          {allowed.has('duplicate') && (
            <Button
              variant="secondary"
              onClick={() => void actions.duplicate(invoice).then((r) => r.ok && router.push(`/invoices/${r.value.id}/edit`))}
            >
              <CopyDocIcon /> {t('duplicate')}
            </Button>
          )}
          {allowed.has('void') && (
            <Button variant="secondary" className={danger} onClick={() => dialogs.open('void', invoice)}>
              <BanIcon /> {t('void')}
            </Button>
          )}
          {allowed.has('delete') && (
            <Button variant="secondary" className={danger} onClick={() => dialogs.open('delete', invoice)}>
              <TrashIcon /> {t('delete')}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2 print:hidden">
        {invoice.status === 'void' && (
          <Alert tone="warning">
            {t('voidedBanner', { date: formatDateTime(invoice.voidedAt, locale, zone) })}
            {invoice.voidReason && <span dir="auto"> - {invoice.voidReason}</span>}
          </Alert>
        )}
        {open && Number(invoice.amountsMinor.paid) > 0 && can.void && (
          <p className="text-xs text-muted-foreground">{t('voidNeedsRefund')}</p>
        )}
        {link && linkStateOf(link) !== 'active' && open && (
          <Alert tone="info">{t('linkOffBanner')}</Alert>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="order-2 min-w-0 space-y-4 lg:order-1">
          <InvoicePaper model={paperFromInvoice(invoice, profile.data)} />
          <TaxWhy invoice={invoice} />
        </div>
        <aside className="order-1 min-w-0 space-y-4 lg:order-2 print:hidden">
          <SummaryCards invoice={invoice} />
          <DetailsCard invoice={invoice} />
          {link && <PublicLinkCard invoice={invoice} canChange={can.update && open} />}
          {issued && <PaymentsSection invoice={invoice} />}
          {issued && <CreditNotesCard invoiceId={invoice.id} canCreate={allowed.has('creditNote')} />}
          <ActivityTimeline invoiceId={invoice.id} />
        </aside>
      </div>

      {dialogs.node}
      {editing && <EditDetailsDialog invoice={invoice} onClose={() => setEditing(false)} />}
    </div>
  );
}
