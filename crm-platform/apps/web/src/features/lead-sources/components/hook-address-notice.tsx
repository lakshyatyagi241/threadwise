'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { fetchSources, leadKeys } from '../api';

/**
 * The warning shown BEFORE a webhook source is created when the server cannot build a complete public address for it (BL-061): the
 * platform's public API address is not set, or points at a machine no ad platform can reach. After creation the one-time reveal says
 * the same for the address itself. Nothing renders while the list loads or when the address is fine.
 */
export function HookAddressNotice() {
  const t = useTranslations('lead-sources.hookAddress');
  const list = useQuery({
    queryKey: leadKeys.list,
    queryFn: ({ signal }) => fetchSources(signal),
    retry: false,
  });
  const problem = list.data?.hookAddress.problem;
  if (!problem) return null;
  return (
    <Alert tone="warning" data-testid="hook-address-notice">
      <p className="font-medium">{t('title')}</p>
      <p className="text-sm">
        {t(problem === 'base_url_not_public' ? 'notPublic' : 'notConfigured')}
      </p>
    </Alert>
  );
}
