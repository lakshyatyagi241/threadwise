import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BoardPage } from '@/features/platform-support-desk/operator/board-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-support-desk.nav');
  return { title: t('team') };
}

export default function Page() {
  return <BoardPage />;
}
