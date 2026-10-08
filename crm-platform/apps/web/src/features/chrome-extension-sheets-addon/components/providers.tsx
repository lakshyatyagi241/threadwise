'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Google Sheets add-on page (one region, translated dismiss label). */
export function SheetsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('chrome-extension-sheets-addon.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
