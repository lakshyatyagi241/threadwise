import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SecurityView } from '@/features/auth-registration-security/account/security/security-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.account.hub');
  return { title: t('pages.security.title') };
}

/** `?required=password|mfa` is the forced mode the account gate redirects to (TW-AUTH-032/035). */
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { required } = await searchParams;
  const mode = required === 'password' || required === 'mfa' ? required : undefined;
  return <SecurityView required={mode} />;
}
