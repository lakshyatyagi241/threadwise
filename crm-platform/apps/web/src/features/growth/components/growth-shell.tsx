'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** One frame for the /growth screen: the toasts. */
export function GrowthShell({ children }: { children: ReactNode }) {
  const t = useTranslations('growth.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <div className="space-y-4">{children}</div>
    </ToastProvider>
  );
}
