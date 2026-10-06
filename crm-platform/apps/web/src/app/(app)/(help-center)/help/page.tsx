import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { HelpHome } from '@/features/help-center/help-home';
import { getVisibleHelp } from '@/features/help-center/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('help');
  return { title: t('title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** `/help`: the guides this person may see, with the category rail (`?area=`) and search. */
export default async function HelpPage({ searchParams }: { searchParams: SearchParams }) {
  const view = await getVisibleHelp();
  if (!view) notFound();
  const { area } = await searchParams;
  return <HelpHome entries={view.entries} area={Array.isArray(area) ? area[0] : area} />;
}
