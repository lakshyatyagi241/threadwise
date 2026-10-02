'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the campaign screens (one region, translated dismiss label). */
export function CampaignsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('campaigns.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
