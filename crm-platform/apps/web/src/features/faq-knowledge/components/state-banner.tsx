'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useFaqSettings } from '../api/hooks';

/**
 * Says, on every FAQ screen, when the platform has switched the FAQ engine off, so customers get no FAQ answers and the staff see why.
 * A flow's own switch is on by default and is not shown here: the FAQ settings are not part of the FAQ screens.
 */
export function StateBanner() {
  const t = useTranslations('faq.banner');
  const canRead = useCan('faq.entries.read');
  const settings = useFaqSettings(canRead);
  if (!settings.data || settings.data.engineEnabled) return null;
  return <Alert tone="danger">{t('engineOff')}</Alert>;
}
