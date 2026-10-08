'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Spinner, useToast } from '@crm/ui';
import { KEYS, useDashboard, useOverview } from '../api/ecom';
import { parseTab, type Kind } from '../lib/model';
import { ConnectShopify } from './connect-shopify';
import { ConnectWoo } from './connect-woo';
import { StoreShell } from './store-shell';
import { AnalyticsTab } from './tabs/analytics-tab';
import { AutomationsTab } from './tabs/automations-tab';
import { CustomersTab } from './tabs/customers-tab';
import { InvoicesTab } from './tabs/invoices-tab';
import { LogsTab } from './tabs/logs-tab';
import { OffersTab } from './tabs/offers-tab';
import { OrdersTab } from './tabs/orders-tab';
import { OverviewTab } from './tabs/overview-tab';
import { ProductsTab } from './tabs/products-tab';
import { SettingsTab } from './tabs/settings-tab';

/**
 * `/shopify` and `/woocommerce` (TW-ECOM-004, 023): the connect page when the workspace has no connected store, else the store
 * screen with the tab named in the address. The browser coming back from Shopify's approval page lands here with
 * `?shopify=connected|error&message=...`; the outcome is shown once and taken out of the address.
 */
export function StoreScreen({ kind }: { kind: Kind }) {
  const t = useTranslations('ecom.shell');
  const overview = useOverview(kind);
  const store = overview.data?.store ?? null;
  const live = store !== null && store.connected;
  const dashboard = useDashboard(kind, store?.id ?? '');
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { toast } = useToast();
  const tab = parseTab(search.get('tab'));
  const returned = useRef(false);

  // Shopify's redirect back: show what happened once, refresh what it changed, and clean the address.
  useEffect(() => {
    const outcome = search.get('shopify');
    if (kind !== 'shopify' || !outcome || returned.current) return;
    returned.current = true;
    const message = search.get('message');
    toast(
      message ?? (outcome === 'connected' ? t('flash.success') : t('flash.error')),
      outcome === 'connected' ? 'success' : 'danger',
    );
    void qc.invalidateQueries({ queryKey: KEYS.all });
    router.replace(pathname);
  }, [kind, search, toast, qc, router, pathname, t]);

  if (overview.isPending) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Spinner />
      </div>
    );
  }
  if (overview.isError || !overview.data) {
    return (
      <main className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
        <Alert tone="danger">{t('flash.error')}</Alert>
      </main>
    );
  }
  if (!live || !store) {
    return kind === 'shopify' ? (
      <ConnectShopify
        overview={overview.data as Parameters<typeof ConnectShopify>[0]['overview']}
      />
    ) : (
      <ConnectWoo overview={overview.data as Parameters<typeof ConnectWoo>[0]['overview']} />
    );
  }

  const d = dashboard.data;
  const planVersion =
    'shopPlan' in store ? store.shopPlan : 'storeVersion' in store ? store.storeVersion : null;

  return (
    <StoreShell kind={kind} store={store} tab={tab} dashboard={d} planVersion={planVersion}>
      {dashboard.isError && <Alert tone="danger">{t('flash.error')}</Alert>}
      {!d ? (
        !dashboard.isError && (
          <div className="grid min-h-[30vh] place-items-center">
            <Spinner />
          </div>
        )
      ) : (
        <>
          {tab === 'overview' && <OverviewTab kind={kind} data={d} />}
          {tab === 'orders' && <OrdersTab data={d} />}
          {tab === 'products' && <ProductsTab kind={kind} data={d} />}
          {tab === 'offers' && <OffersTab kind={kind} storeId={store.id} data={d} />}
          {tab === 'customers' && <CustomersTab kind={kind} data={d} />}
          {tab === 'events' && <AutomationsTab kind={kind} storeId={store.id} data={d} />}
          {tab === 'analytics' && <AnalyticsTab kind={kind} data={d} />}
          {tab === 'invoices' && <InvoicesTab kind={kind} storeId={store.id} />}
          {tab === 'logs' && <LogsTab data={d} />}
          {tab === 'settings' && <SettingsTab kind={kind} store={store} />}
        </>
      )}
    </StoreShell>
  );
}
