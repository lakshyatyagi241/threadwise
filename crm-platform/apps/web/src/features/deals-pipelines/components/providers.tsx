'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for every screen of the domain (one region, translated dismiss label). */
export function DealsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('deals-pipelines.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
