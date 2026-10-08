'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Auto-assignment screens. */
export function RoutingProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('team-inbox-routing-sla.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
