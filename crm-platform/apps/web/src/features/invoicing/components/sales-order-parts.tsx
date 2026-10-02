'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type {
  CancelOrderInput,
  FulfilmentStatus,
  FulfilOrderInput,
  InvoiceFromOrderInput,
  InvoicingStatus,
  SalesOrderStatus,
} from '@crm/contracts';
import { cn, useToast } from '@crm/ui';
import { invalidateInvoicing } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { fulfilmentTone, invoicingTone, orderStatusTone, quoteHref, type ChipTone } from '../lib/sales-orders';
import { useErrorText } from './parts';
import type { Outcome } from './use-invoice-actions';

export const salesOrderHref = (id: string): string => `/sales-orders/${id}`;
export const salesOrderEditHref = (id: string): string => `/sales-orders/${id}/edit`;

/** `/sales-orders/new`, optionally from an accepted offer (`quote`), a contact or a deal. */
export function newSalesOrderHref(from?: { quote?: string; contact?: string; deal?: string }): string {
  const p = new URLSearchParams();
  if (from?.quote) p.set('quote', from.quote);
  if (from?.contact) p.set('contact', from.contact);
  if (from?.deal) p.set('deal', from.deal);
  const s = p.toString();
  return `/sales-orders/new${s ? `?${s}` : ''}`;
}

const TONE: Record<ChipTone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  info: 'border-primary/30 bg-primary/10 text-primary',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  success: 'border-success/30 bg-success/10 text-success',
  danger: 'border-danger/30 bg-danger/10 text-danger',
};
const DOT: Record<ChipTone, string> = {
  neutral: 'bg-muted-foreground',
  info: 'bg-primary',
  warning: 'bg-warning',
  success: 'bg-success',
  danger: 'bg-danger',
};

function Chip({ tone, children, className }: { tone: ChipTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE[tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}

export function OrderStatusChip({ status, className }: { status: SalesOrderStatus; className?: string }) {
  const t = useTranslations('invoicing.salesOrders.status');
  return (
    <Chip tone={orderStatusTone(status)} className={cn(status === 'cancelled' && 'line-through decoration-danger/60', className)}>
      {t(status)}
    </Chip>
  );
}

export function InvoicingChip({ status, className }: { status: InvoicingStatus; className?: string }) {
  const t = useTranslations('invoicing.salesOrders.invoicingStatus');
  return (
    <Chip tone={invoicingTone(status)} className={className}>
      {t(status)}
    </Chip>
  );
}

export function FulfilmentChip({ status, className }: { status: FulfilmentStatus; className?: string }) {
  const t = useTranslations('invoicing.salesOrders.fulfilmentStatus');
  return (
    <Chip tone={fulfilmentTone(status)} className={className}>
      {t(status)}
    </Chip>
  );
}

const BAR: Record<'brand' | 'success', string> = { brand: 'bg-primary', success: 'bg-success' };

/** A thin progress bar: `pct` is a whole percent computed with integer math (lib/sales-orders `progressPercent`). */
export function ProgressBar({ pct, label, className }: { pct: number; label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      {/* the fill grows from the reading start, so it mirrors in RTL by itself */}
      <div className={cn('h-full rounded-full transition-[width]', pct >= 100 ? BAR.success : BAR.brand)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The offer an order or invoice came from: a link to its proposal or estimate page (the order carries the kind of the document). */
export function QuoteLink({ quote, className }: { quote: { id: string; number: string; kind?: 'proposal' | 'estimate' } | null; refine?: boolean; className?: string }) {
  if (!quote) return <span className="text-muted-foreground">-</span>;
  return (
    <Link
      href={quoteHref(quote)}
      title={quote.number}
      onClick={(e) => e.stopPropagation()}
      className={cn('block truncate text-primary outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary', className)}
    >
      <span dir="ltr">{quote.number}</span>
    </Link>
  );
}

/** Each action with its toast and a refresh of every list; a dialog asks for `quiet` and prints the failure next to its form. */
export function useSalesOrderActions() {
  const t = useTranslations('invoicing.salesOrders.actions');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();

  async function run<T>(fn: () => Promise<T>, done: (r: T) => string, opts: { quiet?: boolean } = {}): Promise<Outcome<T>> {
    try {
      const value = await fn();
      await invalidateInvoicing(qc);
      toast(done(value));
      return { ok: true, value };
    } catch (error) {
      if (!opts.quiet) toast(`${t('failed')} ${errorText(error)}`, 'danger');
      return { ok: false, error };
    }
  }

  return {
    confirm: (id: string, opts?: { quiet?: boolean }) =>
      run(() => invoicingApi.confirmSalesOrder(id), (o) => t('confirmed', { number: o.number }), opts),
    invoice: (id: string, body: InvoiceFromOrderInput, opts?: { quiet?: boolean }) =>
      run(
        () => invoicingApi.invoiceSalesOrder(id, body),
        (r) => t(r.invoice.status === 'draft' ? 'invoicedDraft' : 'invoicedIssued', { number: r.invoice.number ?? '' }),
        opts,
      ),
    fulfil: (id: string, body: FulfilOrderInput, opts?: { quiet?: boolean }) =>
      run(() => invoicingApi.fulfilSalesOrder(id, body), () => t('fulfilled'), opts),
    cancel: (id: string, body: CancelOrderInput, opts?: { quiet?: boolean }) =>
      run(() => invoicingApi.cancelSalesOrder(id, body), (o) => t('cancelled', { number: o.number }), opts),
    remove: (id: string, opts?: { quiet?: boolean }) => run(() => invoicingApi.removeSalesOrder(id), () => t('deleted'), opts),
  };
}
