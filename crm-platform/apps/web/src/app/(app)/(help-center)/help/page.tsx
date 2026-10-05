import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { HelpHome } from '@/features/help-center/help-home';
import { getVisibleHelp } from '@/features/help-center/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('help');
  return { title: t('title') };
}

/** `/help`: the guides this person may see, grouped by area, with search. */
export default async function HelpPage() {
  const view = await getVisibleHelp();
  if (!view) notFound();
  return <HelpHome entries={view.entries} />;
}
