'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { StoreGatewayDriver } from '@crm/contracts';
import { Alert, Button, EmptyState, Input } from '@crm/ui';
import { StoreShell } from '@/features/storefront-builder';
import { useGatewayDrivers, useGateways } from '../api/hooks';
import {
  chooseScope,
  defaultOverrideShop,
  filterDrivers,
  orderDrivers,
  savedForScope,
  scopeStorefrontId,
  type GatewayScope,
} from '../lib/gateway-scope';
import { GatewayCard } from './gateway-card';
import { GatewayDrawer } from './gateway-drawer';
import { GatewayResolved } from './gateway-resolved';
import { GatewayScopePicker } from './gateway-scope-picker';
import {
  ErrorPanel,
  NoAccess,
  PageHeader,
  Skeleton,
  useShopParam,
  useStoreCan,
  useStoreShops,
} from './parts';

/** `/store/gateways`: the one payment gateway setup that the store checkout and Sales invoices share. */
export function GatewaysScreen() {
  const can = useStoreCan('gateways');
  return (
    <StoreShell>{can.read ? <GatewaysBody canManage={can.manage} /> : <NoAccess />}</StoreShell>
  );
}

function GatewaysBody({ canManage }: { canManage: boolean }) {
  const t = useTranslations('checkout-orders-merchant-payments.gateways');
  const shopParam = useShopParam();
  const overview = useStoreShops(shopParam);
  const drivers = useGatewayDrivers();
  const rows = useGateways();

  const shops = useMemo(
    () => (overview.data?.shops ?? []).map((s) => ({ id: s.id, name: s.shopName ?? s.slug })),
    [overview.data],
  );
  const [kind, setKind] = useState<GatewayScope['kind']>('workspace');
  const [chosenShop, setChosenShop] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<StoreGatewayDriver | null>(null);

  const fallbackShop = defaultOverrideShop(shopParam, overview.data?.shop.id, shops);
  const shopId =
    chosenShop && (shops.length === 0 || shops.some((s) => s.id === chosenShop))
      ? chosenShop
      : fallbackShop;
  const scope = chooseScope(kind, shopId);
  const storefrontId = scopeStorefrontId(scope);
  const shopName = shops.find((s) => s.id === shopId)?.name ?? '';
  const scopeText =
    scope.kind === 'workspace' ? t('scope.workspace') : t('scope.storeNamed', { shop: shopName });

  const all = rows.data?.data ?? [];
  const visible = filterDrivers(orderDrivers(drivers.data?.data ?? [], all, scope), query);

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />

      <Alert tone="info" data-testid="gateway-banner">
        {t('banner')}
      </Alert>

      {!canManage && <Alert tone="info">{t('viewOnly')}</Alert>}

      <section className="space-y-4 rounded-xl border border-border bg-background p-4">
        <GatewayScopePicker
          kind={scope.kind}
          onKind={setKind}
          shops={shops}
          shopId={shopId}
          onShop={setChosenShop}
        />
        <GatewayResolved storefrontId={storefrontId} />
      </section>

      <section className="space-y-3" aria-labelledby="gateways-catalogue">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="gateways-catalogue" className="text-lg font-semibold">
              {t('catalogue.title')}
            </h2>
            {drivers.data && (
              <p className="text-xs text-muted-foreground">
                {t('catalogue.count', { count: drivers.data.data.length })}
              </p>
            )}
          </div>
          <div className="w-full sm:w-72">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('catalogue.searchPlaceholder')}
              aria-label={t('catalogue.search')}
            />
          </div>
        </div>

        {drivers.isPending || rows.isPending ? (
          <div
            role="status"
            aria-label={t('catalogue.loading')}
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        ) : drivers.isError ? (
          <ErrorPanel error={drivers.error} onRetry={() => void drivers.refetch()} />
        ) : rows.isError ? (
          <ErrorPanel error={rows.error} onRetry={() => void rows.refetch()} />
        ) : drivers.data.data.length === 0 ? (
          <EmptyState
            title={t('catalogue.noDriversTitle')}
            message={t('catalogue.noDriversMessage')}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={t('catalogue.noMatchTitle')}
            message={t('catalogue.noMatchMessage')}
            actions={
              <Button variant="secondary" onClick={() => setQuery('')}>
                {t('catalogue.clearSearch')}
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="gateway-catalogue">
            {visible.map((d) => (
              <GatewayCard
                key={`${d.slug}:${storefrontId ?? 'workspace'}`}
                driver={d}
                saved={savedForScope(all, d.slug, scope)}
                storefrontId={storefrontId}
                scopeText={scopeText}
                canManage={canManage}
                onConfigure={setEditing}
              />
            ))}
          </ul>
        )}
      </section>

      {editing && canManage && (
        <GatewayDrawer
          key={`${editing.slug}:${storefrontId ?? 'workspace'}`}
          driver={editing}
          saved={savedForScope(all, editing.slug, scope)}
          storefrontId={storefrontId}
          scopeText={scopeText}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
