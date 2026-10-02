import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GatewaysPage } from '@/features/platform-payment-gateways/components/gateways-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform-payment-gateways.admin');
  return { title: t('title') };
}

export default function OperatorPaymentGatewaysPage() {
  return <GatewaysPage />;
}
