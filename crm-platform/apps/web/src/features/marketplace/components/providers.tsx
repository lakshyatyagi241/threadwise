'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Marketplace screens (one region, translated dismiss label). */
export function MarketplaceProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('marketplace.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
