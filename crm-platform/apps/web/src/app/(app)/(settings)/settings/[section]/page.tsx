import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SETTINGS_SECTIONS, isSettingsSection } from '@/features/_registry/settings-types';
import { SectionPanel } from '@/features/settings-hub/section-panel';

export const dynamicParams = false;

export function generateStaticParams() {
  return SETTINGS_SECTIONS.map((section) => ({ section }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  if (!isSettingsSection(section)) return {};
  const t = await getTranslations('settings');
  return { title: `${t(`sections.${section}.title`)} - ${t('title')}` };
}

/** `/settings/<section>`: one section's tiles. An unknown section is a 404. */
export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isSettingsSection(section)) notFound();
  return <SectionPanel section={section} />;
}
