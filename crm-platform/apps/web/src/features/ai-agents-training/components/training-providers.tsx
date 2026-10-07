'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the AI Training screens (one region, translated dismiss label). */
export function TrainingProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('aiTraining.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
