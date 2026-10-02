import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ConsolePage } from '@/features/bsp-billing-engine/components/console-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('bsp-billing-engine.nav');
  return { title: t('reseller') };
}

export default function OperatorBspCreditPage() {
  return <ConsolePage />;
}
