'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Google account page (one region, translated dismiss label). */
export function GoogleAccountProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('google-account.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
