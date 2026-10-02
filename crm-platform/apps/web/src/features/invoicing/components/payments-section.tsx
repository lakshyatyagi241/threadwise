'use client';

import type { InvoiceSummary, PaymentResponse } from '@crm/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Spinner, cn } from '@crm/ui';
import { useInvoiceEvents, useInvoicePayments } from '../api/hooks';
import { formatDateTime } from '../lib/dates';
import { isTimelineEvent, type TimelineEvent } from '../lib/labels';
import { hasRefundable } from '../lib/status';
import { exponentOf, formatMoney } from '../lib/money';
import { majorToMinor, minorOf } from '../lib/wire';
import { UndoIcon } from './icons';
import { ErrorLine, MethodChip, Money, useInvoicingCan, useWorkspaceZone } from './parts';
import { RefundDialog } from './payment-dialogs';

/**
 * The ledger entries of one invoice, newest first: payments (method, receipt number, reference, a "Refund" action while
 * something is left to refund) and the refunds that give money back (negative, with the payment they return).
 */
export function PaymentsSection({ invoice }: { invoice: Pick<InvoiceSummary, 'id' | 'status'> }) {
  const t = useTranslations('invoicing.paymentsSection');
  const locale = useLocale();
  const zone = useWorkspaceZone();
  const can = useInvoicingCan();
  const payments = useInvoicePayments(can.readPayments ? invoice.id : null);
  const [refunding, setRefunding] = useState<PaymentResponse | null>(null);

  if (!can.readPayments) return null;
  return (
    <section
      aria-labelledby="inv-payments"
      className="rounded-xl border border-border bg-background p-4"
    >
      <h2 id="inv-payments" className="mb-3 text-sm font-semibold">
        {t('title')}
      </h2>
      {payments.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : payments.isError ? (
        <ErrorLine error={payments.error} onRetry={() => void payments.refetch()} />
      ) : (payments.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {(payments.data ?? []).map((p) => {
            const isRefund = p.kind === 'refund';
            return (
              <li key={p.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Money
                      minor={minorOf(p.amountMinor)}
                      currency={p.currency}
                      className={cn('font-semibold', isRefund && 'text-danger')}
                    />
                    {isRefund ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                        <UndoIcon className="size-3" /> {t('refundChip')}
                      </span>
                    ) : (
                      <MethodChip method={p.method} />
                    )}
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(p.paidAt, locale, zone)}
                  </span>
                </div>
                {p.receiptNumber && (
                  <p className="text-xs text-muted-foreground">
                    {t('receipt')} <span dir="ltr">{p.receiptNumber}</span>
                    {isRefund && p.refundOf?.receiptNumber && (
                      <>
                        {' - '}
                        {t('refundOf', { receipt: p.refundOf.receiptNumber })}
                      </>
                    )}
                  </p>
                )}
                {(p.reference || p.note) && (
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {[p.reference, p.note].filter(Boolean).join(' - ')}
                  </p>
                )}
                {!isRefund && Number(p.refunded) > 0 && (
                  <p className="text-xs text-danger">
                    {t('refundedSoFar', {
                      amount: formatMoney(
                        majorToMinor(p.refunded, exponentOf(p.currency)),
                        p.currency,
                        locale,
                      ),
                    })}
                  </p>
                )}
                {can.refund && hasRefundable(p) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ms-2"
                    onClick={() => setRefunding(p)}
                  >
                    <UndoIcon /> {t('refund')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {refunding && <RefundDialog payment={refunding} onClose={() => setRefunding(null)} />}
    </section>
  );
}

/** Dot colour of a timeline entry by event type; a type the screen does not know yet gets a neutral dot and its raw name. */
const DOT: Record<TimelineEvent, string> = {
  created: 'bg-muted-foreground',
  edited: 'bg-muted-foreground',
  issued: 'bg-primary',
  sent: 'bg-primary',
  viewed: 'bg-primary',
  payment_recorded: 'bg-success',
  payment_refunded: 'bg-danger',
  paid: 'bg-success',
  partially_paid: 'bg-warning',
  overdue: 'bg-danger',
  voided: 'bg-danger',
  link_regenerated: 'bg-muted-foreground',
  link_revoked: 'bg-muted-foreground',
  pay_attempt: 'bg-warning',
  credit_note_issued: 'bg-primary',
};

/** The invoice's timeline, newest first: who did what and when (a person, the buyer, the payment gateway or the system). */
export function ActivityTimeline({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations('invoicing.activity');
  const locale = useLocale();
  const zone = useWorkspaceZone();
  const events = useInvoiceEvents(invoiceId);
  return (
    <section
      aria-labelledby="inv-activity"
      className="rounded-xl border border-border bg-background p-4"
    >
      <h2 id="inv-activity" className="mb-3 text-sm font-semibold">
        {t('title')}
      </h2>
      {events.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : events.isError ? (
        <ErrorLine error={events.error} onRetry={() => void events.refetch()} />
      ) : (events.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ol className="space-y-3">
          {(events.data ?? []).map((e) => {
            const who = e.actor.kind === 'user' ? e.actor.user?.name : t(`actors.${e.actor.kind}`);
            return (
              <li key={e.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    isTimelineEvent(e.type) ? DOT[e.type] : 'bg-muted-foreground',
                  )}
                />
                <div className="min-w-0 text-sm">
                  <div>{isTimelineEvent(e.type) ? t(`events.${e.type}`) : e.type}</div>
                  {e.detail && (
                    <div className="break-words text-xs text-muted-foreground" dir="auto">
                      {e.detail}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(e.at, locale, zone)}
                    {who && <span dir="auto"> - {who}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
