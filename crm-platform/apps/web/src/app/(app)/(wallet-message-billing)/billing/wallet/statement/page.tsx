import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { StatementPage } from '@/features/wallet-message-billing/components/customer/statement-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet-message-billing.statement');
  return { title: t('title') };
}

export default function BillingWalletStatementPage() {
  // The filters live in the address (?type=&from=&to=&q=), which needs a Suspense boundary.
  return (
    <Suspense>
      <StatementPage />
    </Suspense>
  );
}
