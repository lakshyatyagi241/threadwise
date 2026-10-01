'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Tasks screens (one region, translated dismiss label). */
export function TasksProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('tasks.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
