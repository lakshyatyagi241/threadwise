'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the flow screens (one region, translated dismiss label). Messages from Save and Publish appear under the top bar, beside those buttons. */
export function FlowsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('flb.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')} placement="top">
      {children}
    </ToastProvider>
  );
}
