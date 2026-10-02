'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** The toast region of the invoicing screens. */
export function InvoicingProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('invoicing.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
