'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the calling screens (one region, translated dismiss label). */
export function CallingProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('calling-voice.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
