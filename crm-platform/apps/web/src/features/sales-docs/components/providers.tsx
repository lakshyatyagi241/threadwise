'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the sales-docs screens and the buyer's page (one region, translated dismiss label). */
export function SalesDocsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('sales-docs.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
