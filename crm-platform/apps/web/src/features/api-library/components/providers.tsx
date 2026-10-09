'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the API Library screens. */
export function ApiLibraryProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('api-library.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
