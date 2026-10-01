import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DeleteAccountView } from '@/features/auth-registration-security/account/delete/delete-account-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.account.hub');
  return { title: t('pages.delete.title') };
}

export default function DeleteAccountPage() {
  return <DeleteAccountView />;
}
