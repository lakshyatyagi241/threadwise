import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OperatorMfaEnrolment } from '@/features/auth-registration-security/platform/account/operator-mfa-enrolment';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.platform');
  return { title: t('nav.account') };
}

export default function OperatorAccountSecurityPage() {
  return <OperatorMfaEnrolment />;
}
