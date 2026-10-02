'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Modal, Spinner } from '@crm/ui';
import { useInvoicesList } from '../api/hooks';
import type { InvoiceStatus, InvoiceSummary } from '@crm/contracts';
import { SearchIcon } from './icons';
import { rowBalanceMinor } from '../lib/invoice-facts';
import { ErrorLine, Money, StatusChip, UserText } from './parts';

/** The statuses that can still take a payment. */
export const PAYABLE_STATUSES: readonly InvoiceStatus[] = ['issued', 'partially_paid', 'overdue'];

/**
 * The first step of "Record payment" from the ledger, where no invoice is chosen yet: pick one of the invoices that still owe
 * money (search by number or customer), then the payment form opens on its balance. `statuses` narrows or widens the list.
 */
export function PickInvoiceDialog({
  onPick,
  onClose,
  statuses = [...PAYABLE_STATUSES],
}: {
  onPick: (inv: InvoiceSummary) => void;
  onClose: () => void;
  statuses?: InvoiceStatus[];
}) {
  const t = useTranslations('invoicing.pickInvoice');
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const h = window.setTimeout(() => setTerm(text.trim()), 250);
    return () => window.clearTimeout(h);
  }, [text]);
  const list = useInvoicesList({ status: statuses.join(','), q: term || undefined }, { limit: 20 });

  return (
    <Modal
      open
      size="md"
      onClose={onClose}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            type="search"
            value={text}
            placeholder={t('search')}
            aria-label={t('search')}
            className="ps-9"
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {list.isPending ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : list.isError ? (
          <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
        ) : list.items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{term ? t('noMatch') : t('nothingOwed')}</p>
        ) : (
          <ul className="thin-scrollbar max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {list.items.map((inv) => (
              <li key={inv.id}>
                <button
                  type="button"
                  onClick={() => onPick(inv)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-start outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium" dir="ltr">
                      {inv.number}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <UserText>{inv.buyerName ?? inv.contact?.name ?? ''}</UserText>
                    </span>
                  </span>
                  <StatusChip status={inv.status} />
                  <span className="text-end">
                    <span className="block text-xs text-muted-foreground">{t('balance')}</span>
                    <Money minor={rowBalanceMinor(inv) ?? 0} currency={inv.currency} className="font-semibold" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <Button variant="secondary" size="sm" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {t('more')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
