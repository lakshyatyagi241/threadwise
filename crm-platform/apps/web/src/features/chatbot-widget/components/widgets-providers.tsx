'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the widget screens (one region, translated dismiss label). */
export function WidgetsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('chatbotWidget.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
