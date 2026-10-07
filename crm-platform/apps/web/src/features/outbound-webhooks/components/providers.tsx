'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Webhooks screen. */
export function WebhooksProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('outbound-webhooks.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
