'use client';

import { useTranslations } from 'next-intl';
import { ToastProvider } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { BillingModeCard } from './billing-mode-card';

/** The customer's page for WD-BSP-011: a title, the two billing cards and the numbers they cover. */
export function BillingModePage() {
  const t = useTranslations('bsp-billing-engine.customer');
  const tc = useTranslations('bsp-billing-engine.common');
  const canManage = useCan('bsp.billing.manage');
  return (
    <ToastProvider dismissLabel={tc('dismiss')}>
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </header>
        <BillingModeCard canManage={canManage} />
      </div>
    </ToastProvider>
  );
}
