'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Telegram screens (one region, translated dismiss label). */
export function TelegramProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('telegram.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
