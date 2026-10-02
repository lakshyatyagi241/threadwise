'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Appointments screens (one region, translated dismiss label). */
export function AppointmentsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('appointments.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
