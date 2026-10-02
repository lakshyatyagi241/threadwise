import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WalletPage } from '@/features/wallet-message-billing/components/customer/wallet-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet-message-billing.wallet');
  return { title: t('title') };
}

export default function BillingWalletPage() {
  return <WalletPage />;
}
