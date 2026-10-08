'use client';

import { useTranslations } from 'next-intl';
import { Input, Select } from '@crm/ui';
import { StoreShell } from '@/features/storefront-builder';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { INVOICE_STATUSES } from '@crm/contracts';
import { useStoreInvoices } from '../api/store-invoices';
import { withShop } from '../lib/format';
import { parseStatusParam } from '../lib/store-invoices';
import { useUrlParam } from './groups-url-state';
import { InvoicesTable } from './invoices-rows';
import {
  ErrorPanel,
  LinkButton,
  LoadMore,
  NoAccess,
  PageHeader,
  TableSkeleton,
  useShopParam,
} from './parts';

/**
 * `/store/invoices`: the Sales invoices that were created from store orders. Not a second invoice list: it reads the Sales list and
 * keeps the rows whose source is `own` (the list API has no source filter, so that happens here), and every row opens in Sales.
 */
export function StoreInvoicesScreen() {
  const t = useTranslations('checkout-orders-merchant-payments.invoices');
  const canRead = useCan('record.invoices.read');
  return (
    <StoreShell>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canRead ? (
            <LinkButton href="/invoices" variant="secondary">
              {t('allInvoices')}
            </LinkButton>
          ) : undefined
        }
      />
      {canRead ? <InvoicesBody /> : <NoAccess />}
    </StoreShell>
  );
}

function InvoicesBody() {
  const t = useTranslations('checkout-orders-merchant-payments.invoices');
  const shop = useShopParam();
  const search = useUrlParam('q', 300);
  const statusParam = useUrlParam('status');
  const q = search.applied.trim();
  const status = parseStatusParam(statusParam.applied);
  const list = useStoreInvoices({ q: q || undefined, status });
  const filtered = q !== '' || status !== undefined;

  return (
    <div className="rounded-xl border border-border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1 basis-60 sm:max-w-md">
          <Input
            type="search"
            value={search.value}
            onChange={(e) => search.setValue(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.label')}
            maxLength={100}
          />
        </div>
        <div className="w-full sm:w-52">
          <Select
            value={status ?? ''}
            onChange={(e) => statusParam.setValue(e.target.value)}
            aria-label={t('status.label')}
          >
            <option value="">{t('status.all')}</option>
            {INVOICE_STATUSES.map((s) => (
              <StatusOption key={s} status={s} />
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {list.isPending ? (
          <TableSkeleton label={t('loading')} />
        ) : list.isError ? (
          <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
        ) : list.items.length === 0 ? (
          list.searching ? (
            <TableSkeleton rows={3} label={t('searching')} />
          ) : list.hasNextPage ? (
            <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
              <div className="text-lg font-semibold">{t('capped.title')}</div>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                {t('capped.message')}
              </p>
              <LoadMore
                hasMore
                loading={list.isFetchingNextPage}
                onMore={() => void list.fetchNextPage()}
              />
            </div>
          ) : filtered ? (
            <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
              <div className="text-lg font-semibold">{t('noMatch.title')}</div>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                {t('noMatch.message')}
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
              <div className="text-lg font-semibold">{t('empty.title')}</div>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                {t('empty.message')}
              </p>
              <div className="mt-5 flex justify-center">
                <LinkButton href={withShop('/store/orders', shop)} variant="secondary">
                  {t('empty.action')}
                </LinkButton>
              </div>
            </div>
          )
        ) : (
          <>
            <InvoicesTable items={list.items} />
            {list.searching && (
              <p role="status" className="text-center text-xs text-muted-foreground">
                {t('searching')}
              </p>
            )}
            {list.stoppedAtCap && !list.searching && (
              <p className="text-center text-xs text-muted-foreground">{t('capped.note')}</p>
            )}
            <LoadMore
              hasMore={Boolean(list.hasNextPage) && !list.searching}
              loading={list.isFetchingNextPage}
              onMore={() => void list.fetchNextPage()}
            />
          </>
        )}
      </div>
    </div>
  );
}

function StatusOption({ status }: { status: string }) {
  const t = useTranslations('invoicing.status');
  return <option value={status}>{t.has(status) ? t(status) : status}</option>;
}
