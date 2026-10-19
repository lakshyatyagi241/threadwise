'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Video meetings page (one region, translated dismiss label). */
export function MeetingConferencingProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('meeting-conferencing.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
