'use client';

import { useTranslations } from 'next-intl';
import { useOverview } from '../api/catalog';
import { ConnectedView } from './setup-connected';
import { LoadError, LoadingBlock } from './parts';
import { NoSenderCard, ReadyView } from './setup-states';

/**
 * The Setup tab (TW-CAT-008): "Connect a device first" with nothing connected, "Ready to send" with a sender but no Meta
 * catalog, and the full connected screen once a catalog is linked.
 */
export function SetupTab() {
  const t = useTranslations('catalogProducts.setup');
  const overview = useOverview();

  if (overview.isPending) return <LoadingBlock label={t('loading')} />;
  if (overview.isError) {
    return (
      <LoadError
        error={overview.error}
        title={t('loadError')}
        onRetry={() => void overview.refetch()}
      />
    );
  }
  const data = overview.data;
  if (data.catalog) return <ConnectedView overview={data} catalog={data.catalog} />;
  return data.hasSender ? <ReadyView overview={data} /> : <NoSenderCard />;
}
