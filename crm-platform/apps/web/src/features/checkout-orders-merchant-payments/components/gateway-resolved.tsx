'use client';

import { useTranslations } from 'next-intl';
import type { StoreGatewaySource } from '@crm/contracts';
import { useResolvedGateway } from '../api/hooks';
import { ErrorPanel, Skeleton, ToneBadge } from './parts';

/**
 * "Currently used": the gateway a checkout of the selected shop (or an invoice, for the workspace) would pick right now, with where
 * it came from. Read from the server's own resolver so the screen and the checkout can never disagree.
 */
export function GatewayResolved({ storefrontId }: { storefrontId: string | undefined }) {
  const t = useTranslations('checkout-orders-merchant-payments.gateways');
  const q = useResolvedGateway(storefrontId);

  if (q.isPending) return <Skeleton className="h-14" />;
  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />;

  const r = q.data.resolved;
  if (!r) {
    return (
      <div
        className="rounded-lg border border-dashed border-border px-4 py-3 text-sm"
        data-testid="gateway-resolved"
        data-state="none"
      >
        <div className="font-medium">{t('resolved.none')}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('resolved.noneHint')}</p>
      </div>
    );
  }

  const source = (s: StoreGatewaySource) =>
    s === 'store_override'
      ? t('resolved.source.store_override')
      : s === 'workspace_default'
        ? t('resolved.source.workspace_default')
        : t('resolved.source.legacy_storefront');

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm"
      data-testid="gateway-resolved"
      data-state="set"
    >
      <span className="font-medium">
        {t('resolved.used', { name: r.name, source: source(r.source) })}
      </span>
      <ToneBadge tone={r.mode === 'live' ? 'success' : 'warning'}>
        {r.mode === 'live' ? t('mode.live') : t('mode.test')}
      </ToneBadge>
    </div>
  );
}
