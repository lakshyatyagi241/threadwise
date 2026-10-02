import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MarginsPage } from '@/features/wallet-message-billing/components/admin/margins-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet-message-billing.admin.nav');
  return { title: t('margins') };
}

export default function MarginsPageRoute() {
  return <MarginsPage />;
}
