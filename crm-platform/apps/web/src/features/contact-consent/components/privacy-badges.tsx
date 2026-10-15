'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useContactConsent } from '../api/hooks';

/**
 * The privacy flags of a contact as badges in the contact's header (BL-180): minor, guardian consent on record, opted out of sale or
 * sharing. It reads the same query as the Consent card (one request for both) and shows nothing without `contacts.consent.read`, while
 * loading, or when no flag is on.
 */
export function ContactPrivacyBadges({ contactId }: { contactId: string }) {
  const canRead = useCan('contacts.consent.read');
  const t = useTranslations('contact-consent.card.privacy');
  const q = useContactConsent(contactId, canRead);
  const p = q.data?.privacy;
  if (!canRead || !p) return null;
  return (
    <>
      {p.isMinor && <Badge tone="warning">{t('minorLabel')}</Badge>}
      {p.isMinor && p.guardianConsent && <Badge tone="neutral">{t('guardianBadge')}</Badge>}
      {p.doNotSellShare && <Badge tone="danger">{t('dnsLabel')}</Badge>}
    </>
  );
}
