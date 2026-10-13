'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { StoreCustomer } from '@crm/contracts';
import { Button, ConfirmDialog, EmptyState, Input, useToast } from '@crm/ui';
import { StoreShell } from '@/features/storefront-builder';
import { useCustomers, useDeleteCustomer } from '../api/hooks';
import { ordersHref } from '../lib/customer-form';
import { displayPhone, formatDay, formatInt, withShop } from '../lib/format';
import { CustomerDetailDrawer, Totals } from './customers-detail-drawer';
import { CustomerFormModal } from './customers-form-modal';
import {
  ErrorPanel,
  LoadMore,
  NoAccess,
  PageHeader,
  TableSkeleton,
  Th,
  ToneBadge,
  useErrorLine,
  useShopParam,
  useStoreCan,
} from './parts';

const LINK =
  'font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * `/store/customers`: the shop's customers (Reference /store/customers lists saved customers only; this screen replaces the older Saved
 * customers page). A merchant pre-sets a buyer's name, company and delivery address by phone; here the list also includes every buyer
 * found in the orders, marked "No saved address" until a profile with an address exists, and each row shows what the buyer bought.
 */
export function CustomersScreen() {
  const t = useTranslations('checkout-orders-merchant-payments.customers');
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const shopParam = useShopParam();
  const can = useStoreCan('customers');
  const errorLine = useErrorLine();
  const { toast } = useToast();

  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setQ(text.trim()), 300);
    return () => window.clearTimeout(id);
  }, [text]);

  const list = useCustomers({ q: q || undefined });
  const remove = useDeleteCustomer();
  const [editor, setEditor] = useState<{ customer: StoreCustomer | null } | null>(null);
  const [viewing, setViewing] = useState<StoreCustomer | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoreCustomer | null>(null);

  if (!can.read) {
    return (
      <StoreShell>
        <NoAccess />
      </StoreShell>
    );
  }

  const addButton = can.manage ? (
    <Button onClick={() => setEditor({ customer: null })}>{t('addCustomer')}</Button>
  ) : undefined;

  const onDelete = () => {
    const c = pendingDelete;
    if (!c) return;
    remove.mutate(c.id, {
      onSuccess: () => {
        setPendingDelete(null);
        if (viewing?.id === c.id) setViewing(null);
        toast(t('removed'), 'success');
      },
      onError: (err) => {
        setPendingDelete(null);
        toast(errorLine(err), 'danger');
      },
    });
  };

  return (
    <StoreShell>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={addButton}
      />

      <div className="max-w-xl">
        <Input
          type="search"
          aria-label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          value={text}
          maxLength={120}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {list.isPending ? (
        <TableSkeleton label={tc('loading')} />
      ) : list.isError ? (
        <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        q ? (
          <EmptyState
            title={t('emptyFilteredTitle')}
            message={t('emptyFilteredMessage')}
            actions={
              <Button
                variant="secondary"
                onClick={() => {
                  setText('');
                  setQ('');
                }}
              >
                {tc('clear')}
              </Button>
            }
          />
        ) : (
          <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} actions={addButton} />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-background">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                <tr>
                  <Th>{t('colCustomer')}</Th>
                  <Th>{t('colOrders')}</Th>
                  <Th>{t('colLifetime')}</Th>
                  <Th>{t('colLastOrder')}</Th>
                  <Th>{t('colContact')}</Th>
                  <Th>{t('colAddress')}</Th>
                  <Th end>{tc('actions')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.items.map((c) => {
                  const label = c.name || displayPhone(c.phone);
                  return (
                    <tr
                      key={c.id}
                      data-testid="customer-row"
                      className="cursor-pointer align-top hover:bg-muted/40"
                      onClick={() => setViewing(c)}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="text-start font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={t('openLabel', { name: label })}
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewing(c);
                          }}
                        >
                          {c.name || <span className="text-muted-foreground">{t('unnamed')}</span>}
                        </button>
                        {c.company && <div className="text-muted-foreground">{c.company}</div>}
                        <div dir="ltr" className="text-start text-muted-foreground">
                          {displayPhone(c.phone)}
                        </div>
                        {!c.hasSavedAddress && (
                          <ToneBadge
                            tone="neutral"
                            className="mt-1"
                            data-testid="no-saved-address"
                            title={t('noSavedAddressHint')}
                          >
                            {t('noSavedAddress')}
                          </ToneBadge>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {c.orderCount > 0 ? (
                          <Link
                            href={withShop(ordersHref(c.phone), shopParam)}
                            className={LINK}
                            aria-label={t('ordersLabel', { name: label, count: c.orderCount })}
                          >
                            {formatInt(c.orderCount, locale)}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Totals customer={c} locale={locale} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {c.lastOrderAt ? formatDay(c.lastOrderAt, locale, timeZone) : <Dash />}
                      </td>
                      <td
                        className="whitespace-nowrap px-4 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.contactId ? (
                          <Link href={`/contacts/${c.contactId}`} className={LINK}>
                            {tc('viewContact')}
                          </Link>
                        ) : (
                          <span aria-label={t('noContact')} title={t('noContact')}>
                            <Dash />
                          </span>
                        )}
                      </td>
                      <td className="max-w-[16rem] px-4 py-3">
                        {c.address ? (
                          <span className="line-clamp-2 whitespace-pre-line break-words">
                            {c.address}
                          </span>
                        ) : (
                          <Dash />
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t('viewLabel', { name: label })}
                            onClick={() => setViewing(c)}
                          >
                            {tc('view')}
                          </Button>
                          {can.manage && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={t('editLabel', { name: label })}
                                onClick={() => setEditor({ customer: c })}
                              >
                                {tc('edit')}
                              </Button>
                              {c.hasProfile && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-danger"
                                  aria-label={t('deleteLabel', { name: label })}
                                  onClick={() => setPendingDelete(c)}
                                >
                                  {tc('delete')}
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <LoadMore
            hasMore={Boolean(list.hasNextPage)}
            loading={list.isFetchingNextPage}
            onMore={() => void list.fetchNextPage()}
          />
        </>
      )}

      {editor && (
        <CustomerFormModal
          customer={editor.customer}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            // an order-only buyer gets their profile (and a new id) when edited: keep the open drawer on them
            if (viewing?.id === saved.id || viewing?.phone === saved.phone) setViewing(saved);
          }}
        />
      )}
      <CustomerDetailDrawer
        customer={viewing}
        shopId={shopParam}
        canManage={can.manage}
        onEdit={(c) => setEditor({ customer: c })}
        onDelete={(c) => setPendingDelete(c)}
        onClose={() => setViewing(null)}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('confirmTitle')}
        message={t('confirmMessage')}
        confirmLabel={tc('remove')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={onDelete}
        onClose={() => setPendingDelete(null)}
      />
    </StoreShell>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}
