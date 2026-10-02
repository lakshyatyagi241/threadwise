import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { authFontVariables } from '@/features/auth-registration-security/guest/auth-fonts';
import { AuthPagesEditorPage } from '@/features/auth-registration-security/platform/settings/auth-pages-editor';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.platform');
  return { title: t('nav.authPages') };
}

export default function AuthPagesSettingsPage() {
  // The preview shows the guest pages, so it needs their type (loaded for this route only, not the whole console).
  return <AuthPagesEditorPage fontClass={authFontVariables} />;
}
