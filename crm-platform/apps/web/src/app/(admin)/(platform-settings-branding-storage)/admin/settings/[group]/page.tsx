import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { GroupSettingsPage } from '@/features/platform-settings-branding-storage/components/group-form';
import { specBySlug } from '@/features/platform-settings-branding-storage/fields';

type Props = { params: Promise<{ group: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const spec = specBySlug((await params).group);
  if (!spec) return {};
  const t = await getTranslations(`platform-settings-branding-storage.groups.${spec.group}`);
  return { title: t('title') };
}

/**
 * One page per settings group. The registration, social login and auth-pages screens of the AUTH domain are
 * static routes beside this one and win over it.
 */
export default async function SettingsGroupPage({ params }: Props) {
  const spec = specBySlug((await params).group);
  if (!spec) notFound();
  return <GroupSettingsPage spec={spec} />;
}
