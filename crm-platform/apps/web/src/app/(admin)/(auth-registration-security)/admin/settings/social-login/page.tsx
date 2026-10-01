import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SocialCaptchaSettingsPage } from '@/features/auth-registration-security/platform/settings/social-captcha-settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.platform');
  return { title: t('nav.socialLogin') };
}

export default function SocialLoginSettingsPage() {
  return <SocialCaptchaSettingsPage />;
}
