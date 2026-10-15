'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';

/**
 * "Do not store protected health information." Shown in onboarding and at the top of the Compliance center. The product does not claim
 * HIPAA, does not sign business associate agreements and is not built for health records (docs/privacy/hipaa-not-supported.md).
 */
export function PhiNotice({ className }: { className?: string }) {
  const t = useTranslations('compliance-center.phi');
  return (
    <Alert tone="warning" className={className} data-testid="phi-notice">
      <p className="font-medium">{t('title')}</p>
      <p className="mt-0.5">{t('body')}</p>
    </Alert>
  );
}
