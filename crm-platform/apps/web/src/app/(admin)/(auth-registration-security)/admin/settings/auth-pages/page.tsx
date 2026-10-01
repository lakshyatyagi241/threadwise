import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthPagesEditorPage } from '@/features/auth-registration-security/platform/settings/auth-pages-editor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.platform');
  return { title: t('nav.authPages') };
}

export default function AuthPagesSettingsPage() {
  return <AuthPagesEditorPage />;
}
