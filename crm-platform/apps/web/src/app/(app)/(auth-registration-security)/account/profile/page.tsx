import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProfileView } from '@/features/auth-registration-security/account/profile/profile-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.account.hub');
  return { title: t('pages.profile.title') };
}

export default function ProfilePage() {
  return <ProfileView />;
}
