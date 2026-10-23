'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useGoogleAccount } from '@/features/google-account/api/google-account';
import { useConferencingConnections } from '@/features/meeting-conferencing/api/conferencing';
import { useOverview } from '@/features/shopify-woocommerce/api/ecom';
import { useSettingsTiles } from '@/features/settings-hub/settings-context';
import {
  connectorCategory,
  googleStatus,
  isGoogleConnector,
  meetingsStatus,
  storeStatus,
  type ConnectorEntry,
  type ConnectorStatus,
} from '../lib/connectors';
import { toolTilesFor } from '../lib/tools';

/**
 * The built-in connectors the person may see, as grid entries: the Settings tiles of the Integrations tab with their gates already
 * applied (a role without the permission has no tile, a persona that hides the module has none either, a plan without the feature has
 * it locked), translated, with a category and a connection status.
 *
 * Status reads what each feature's own screen reads (Google account, store overview, video connections), and only for a
 * connector whose tile is present, open and not locked, so a role or plan without it fires no request. `enabled` false (the Mini apps
 * tab) reads nothing and returns no entries. A read that fails leaves the status `unknown`: the card then shows no connection claim.
 */
export function useConnectorEntries(enabled: boolean): ConnectorEntry[] {
  const t = useTranslations();
  const tiles = useSettingsTiles();
  const live = useMemo(
    () => (enabled ? toolTilesFor('integrations', tiles) : []),
    [enabled, tiles],
  );
  const open = (id: string) => live.some((x) => x.id === id && !x.locked && !x.comingSoon);

  const google = useGoogleAccount(live.some((x) => isGoogleConnector(x.id) && open(x.id)));
  const shopify = useOverview('shopify', open('shopify'));
  const woo = useOverview('woocommerce', open('woocommerce'));
  const meetings = useConferencingConnections(open('video-meetings'));

  const statusOf = (id: string): ConnectorStatus => {
    if (isGoogleConnector(id)) return googleStatus(id, google.data);
    if (id === 'shopify') return storeStatus(shopify.data);
    if (id === 'woocommerce') return storeStatus(woo.data);
    if (id === 'video-meetings') return meetingsStatus(meetings.data);
    return 'unknown';
  };

  return live.map((tile) => ({
    id: tile.id,
    name: t(tile.labelKey),
    description: tile.descriptionKey ? t(tile.descriptionKey) : '',
    categorySlug: connectorCategory(tile.id),
    href: tile.href,
    icon: tile.icon,
    locked: tile.locked,
    comingSoon: tile.comingSoon,
    status: tile.locked || tile.comingSoon ? 'unknown' : statusOf(tile.id),
  }));
}
