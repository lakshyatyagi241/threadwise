import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WordsScreen } from '@/features/persona-vocabulary/components/words-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('persona-vocabulary');
  return { title: t('title') };
}

export default function WorkspaceWordsPage() {
  return <WordsScreen />;
}
