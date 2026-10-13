'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** One frame for the /lead-scoring screens: the toasts. */
export function LeadScoringShell({ children }: { children: ReactNode }) {
  const t = useTranslations('lead-scoring.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <div className="space-y-4">{children}</div>
    </ToastProvider>
  );
}
