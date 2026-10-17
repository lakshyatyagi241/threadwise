'use client';

import { useTranslations } from 'next-intl';
import type { MetaLeadPage, MetaLeadSyncState } from '@crm/contracts';
import { Badge } from '@crm/ui';
import { ACCESS_TONE, PAGE_STATUS_TONE, SYNC_TONE } from '../lib/meta-view';

/** The three small status chips of a Meta Page: its Facebook connection, its lead permissions and its lead sync. */

export function SyncChip({ state }: { state: MetaLeadSyncState }) {
  const t = useTranslations('lead-sources.meta.syncState');
  return (
    <Badge tone={SYNC_TONE[state]} data-sync={state}>
      {t(state)}
    </Badge>
  );
}

export function PageStatusChip({ status }: { status: MetaLeadPage['pageStatus'] }) {
  const t = useTranslations('lead-sources.meta.pageStatus');
  return (
    <Badge tone={PAGE_STATUS_TONE[status]} data-page-status={status}>
      {t(status)}
    </Badge>
  );
}

export function AccessChip({ access }: { access: MetaLeadPage['leadAccess'] }) {
  const t = useTranslations('lead-sources.meta.leadAccess');
  return (
    <Badge tone={ACCESS_TONE[access]} data-lead-access={access}>
      {t(access)}
    </Badge>
  );
}
