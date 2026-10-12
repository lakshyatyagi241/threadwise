'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the SMS screens (one region, translated dismiss label). */
export function SmsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('sms.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
