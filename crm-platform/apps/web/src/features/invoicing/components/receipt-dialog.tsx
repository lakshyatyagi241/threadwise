'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Modal, Spinner } from '@crm/ui';
import type { PaymentReceipt, PaymentResponse } from '@crm/contracts';
import { invoicingApi } from '../api/service';
import { formatDateTime } from '../lib/dates';
import { minorNum } from '../lib/aging';
import { PrinterIcon } from './icons';
import { ErrorLine, Money, UserText, useWorkspaceZone } from './parts';

/** Prints only the receipt: the page behind the dialog is hidden for the print job. */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #payment-receipt, #payment-receipt * { visibility: visible !important; }
  dialog:has(#payment-receipt) { position: static !important; max-height: none !important; overflow: visible !important; border: 0 !important; box-shadow: none !important; width: auto !important; }
  #payment-receipt { position: absolute; inset: 0 0 auto 0; padding: 24px; color: #000; background: #fff; }
}`;

/**
 * The printable receipt of one ledger entry (`GET /payments/:id/receipt`): seller, buyer, the entry and where it left the
 * invoice. A refund prints as a refund receipt with the amount negative.
 */
export function ReceiptDialog({ payment, onClose }: { payment: PaymentResponse; onClose: () => void }) {
  const t = useTranslations('invoicing.payments.receipt');
  const receipt = useQuery({
    queryKey: ['invoicing', 'payments', 'receipt', payment.id],
    queryFn: ({ signal }) => invoicingApi.receipt(payment.id, signal),
    retry: false,
  });

  return (
    <Modal
      open
      size="md"
      onClose={onClose}
      eyebrow={payment.receiptNumber ?? undefined}
      title={payment.kind === 'refund' ? t('refundTitle') : t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
          <Button variant="brand" disabled={!receipt.data} onClick={() => window.print()}>
            <PrinterIcon /> {t('print')}
          </Button>
        </>
      }
    >
      <style>{PRINT_CSS}</style>
      {receipt.isPending ? (
        <div role="status" className="flex items-center gap-2 py-6 text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : receipt.isError ? (
        <ErrorLine error={receipt.error} onRetry={() => void receipt.refetch()} />
      ) : (
        <ReceiptBody receipt={receipt.data} />
      )}
    </Modal>
  );
}

function ReceiptBody({ receipt }: { receipt: PaymentReceipt }) {
  const t = useTranslations('invoicing.payments.receipt');
  const tm = useTranslations('invoicing.method');
  const locale = useLocale();
  const zone = useWorkspaceZone();
  const cur = receipt.currency;
  const minor = (v: string) => minorNum(v, cur);
  const refund = receipt.kind === 'refund';
  return (
    <div id="payment-receipt" className="space-y-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('from')}</div>
          <div className="mt-1 font-semibold" dir="auto">
            <UserText>{receipt.seller.name || t('noSeller')}</UserText>
          </div>
          {receipt.seller.address && (
            <div className="mt-0.5 whitespace-pre-line text-muted-foreground" dir="auto">
              {receipt.seller.address}
            </div>
          )}
          {receipt.seller.taxId && (
            <div className="mt-0.5 text-muted-foreground">
              {t('taxId')}: <span dir="ltr">{receipt.seller.taxId}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 sm:text-end">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('to')}</div>
          <div className="mt-1 font-semibold" dir="auto">
            <UserText>{receipt.buyerName || t('noBuyer')}</UserText>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="text-xs font-medium text-muted-foreground">{refund ? t('refunded') : t('received')}</div>
        <Money minor={minor(receipt.amount)} currency={cur} className={refund ? 'text-3xl font-semibold text-danger' : 'text-3xl font-semibold'} />
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
          <dt className="text-muted-foreground">{t('receiptNumber')}</dt>
          <dd dir="ltr" className="text-end font-medium sm:text-start">
            {receipt.receiptNumber ?? '-'}
          </dd>
          <dt className="text-muted-foreground">{t('date')}</dt>
          <dd className="text-end sm:text-start">{formatDateTime(receipt.paidAt, locale, zone)}</dd>
          <dt className="text-muted-foreground">{t('method')}</dt>
          <dd className="text-end sm:text-start">{tm(receipt.method)}</dd>
          <dt className="text-muted-foreground">{t('reference')}</dt>
          <dd className="text-end sm:text-start" dir="auto">
            {receipt.reference ?? '-'}
          </dd>
        </dl>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('invoice')} <span dir="ltr">{receipt.invoice.number ?? ''}</span>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 border-t border-border pt-2">
          <dt className="text-muted-foreground">{t('invoiceTotal')}</dt>
          <dd>
            <Money minor={minor(receipt.invoice.total)} currency={cur} />
          </dd>
          <dt className="text-muted-foreground">{t('invoicePaid')}</dt>
          <dd>
            <Money minor={minor(receipt.invoice.paid)} currency={cur} />
          </dd>
          <dt className="font-medium">{t('invoiceBalance')}</dt>
          <dd className="font-semibold">
            <Money minor={minor(receipt.invoice.balance)} currency={cur} />
          </dd>
        </dl>
      </div>
    </div>
  );
}
