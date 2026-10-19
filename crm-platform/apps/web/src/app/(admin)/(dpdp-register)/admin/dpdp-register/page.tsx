import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DpdpRegisterPage } from '@/features/dpdp-register/platform/dpdp-register-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dpdp-register-admin.page');
  return { title: t('title') };
}

export default function OperatorDpdpRegisterPage() {
  return <DpdpRegisterPage />;
}
