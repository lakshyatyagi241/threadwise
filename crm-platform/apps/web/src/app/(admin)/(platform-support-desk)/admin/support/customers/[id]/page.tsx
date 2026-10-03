import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CustomerDetailPage } from '@/features/platform-support-desk/operator/customers-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-support-desk.nav');
  return { title: t('customers') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetailPage id={id} />;
}
