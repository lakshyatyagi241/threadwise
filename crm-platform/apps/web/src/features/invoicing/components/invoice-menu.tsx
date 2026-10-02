'use client';

import type { InvoiceSummary } from '@crm/contracts';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MenuItem, MenuSeparator } from '@crm/ui';
import { actionFacts } from '../lib/invoice-facts';
import { allowedActions } from '../lib/status';
import {
  BanIcon,
  CheckIcon,
  CopyDocIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  NoteIcon,
  PaymentIcon,
  PencilIcon,
  SendIcon,
  TrashIcon,
} from './icons';
import { useInvoicingCan } from './parts';
import { RowMenu } from './row-menu';
import { useInvoiceActions } from './use-invoice-actions';
import type { DialogKind } from './use-invoice-dialogs';

export const invoiceHref = (id: string) => `/invoices/${id}`;
export const editHref = (id: string) => `/invoices/${id}/edit`;
export const creditNoteHref = (id: string) => `/credit-notes/new?invoice=${id}`;

/** The "..." menu of one invoice: only what its state and the person's permissions allow (see `allowedActions`). */
export function InvoiceRowMenu({
  invoice,
  onDialog,
  onDuplicated,
}: {
  invoice: InvoiceSummary;
  onDialog: (kind: DialogKind, inv: InvoiceSummary) => void;
  /** Called with the new draft, so the list can open it. */
  onDuplicated?: (inv: { id: string }) => void;
}) {
  const t = useTranslations('invoicing.row');
  const router = useRouter();
  const can = useInvoicingCan();
  const actions = useInvoiceActions();
  const allowed = allowedActions(actionFacts(invoice), { can });
  const label = t('moreFor', {
    name: invoice.number ?? invoice.buyerName ?? invoice.contact?.name ?? t('draft'),
  });

  return (
    <RowMenu label={label}>
      {(close) => {
        const run = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <>
            <MenuItem onSelect={run(() => router.push(invoiceHref(invoice.id)))}>
              <EyeIcon /> {t('open')}
            </MenuItem>
            {allowed.has('edit') && (
              <MenuItem onSelect={run(() => router.push(editHref(invoice.id)))}>
                <PencilIcon /> {t('edit')}
              </MenuItem>
            )}
            {allowed.has('issue') && (
              <MenuItem onSelect={run(() => onDialog('send', invoice))}>
                <SendIcon /> {t('issue')}
              </MenuItem>
            )}
            {allowed.has('send') && (
              <MenuItem onSelect={run(() => onDialog('send', invoice))}>
                <SendIcon /> {t('send')}
              </MenuItem>
            )}
            {allowed.has('copyLink') && (
              <MenuItem onSelect={run(() => void actions.copyLink(invoice))}>
                <CopyIcon /> {t('copyLink')}
              </MenuItem>
            )}
            {allowed.has('recordPayment') && (
              <MenuItem onSelect={run(() => onDialog('pay', invoice))}>
                <PaymentIcon /> {t('recordPayment')}
              </MenuItem>
            )}
            {allowed.has('markPaid') && (
              <MenuItem onSelect={run(() => onDialog('markPaid', invoice))}>
                <CheckIcon /> {t('markPaid')}
              </MenuItem>
            )}
            {allowed.has('creditNote') && (
              <MenuItem onSelect={run(() => router.push(creditNoteHref(invoice.id)))}>
                <NoteIcon /> {t('creditNote')}
              </MenuItem>
            )}
            {allowed.has('duplicate') && (
              <MenuItem
                onSelect={run(() => {
                  void actions.duplicate(invoice).then((r) => {
                    if (r.ok) onDuplicated?.(r.value);
                  });
                })}
              >
                <CopyDocIcon /> {t('duplicate')}
              </MenuItem>
            )}
            {invoice.status !== 'draft' && (
              <MenuItem onSelect={run(() => actions.downloadPdf(invoice))}>
                <DownloadIcon /> {t('downloadPdf')}
              </MenuItem>
            )}
            {(allowed.has('void') || allowed.has('delete')) && <MenuSeparator />}
            {allowed.has('void') && (
              <MenuItem danger onSelect={run(() => onDialog('void', invoice))}>
                <BanIcon /> {t('void')}
              </MenuItem>
            )}
            {allowed.has('delete') && (
              <MenuItem danger onSelect={run(() => onDialog('delete', invoice))}>
                <TrashIcon /> {t('delete')}
              </MenuItem>
            )}
          </>
        );
      }}
    </RowMenu>
  );
}
