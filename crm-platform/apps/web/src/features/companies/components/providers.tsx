'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Companies screens (one region, translated dismiss label). */
export function CompaniesProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('companies.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
