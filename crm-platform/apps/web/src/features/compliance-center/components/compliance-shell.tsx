'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** One frame for the /compliance screen: the toasts. */
export function ComplianceShell({ children }: { children: ReactNode }) {
  const t = useTranslations('compliance-center.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <div className="space-y-4">{children}</div>
    </ToastProvider>
  );
}
