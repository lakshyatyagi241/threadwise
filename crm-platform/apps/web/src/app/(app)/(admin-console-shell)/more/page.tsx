import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MorePage } from '@/features/admin-console-shell/more/more-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin-console-shell.more');
  return { title: `${t('titleLead')} ${t('titleTail')}` };
}

export default function MoreRoute() {
  return <MorePage />;
}
