'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Message History screen (one region, translated dismiss label). */
export function HistoryProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('message-history.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
