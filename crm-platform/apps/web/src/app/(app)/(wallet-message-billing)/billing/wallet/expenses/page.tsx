import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { ExpensesPage } from '@/features/wallet-message-billing/components/customer/expenses-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet-message-billing.expenses');
  return { title: t('title') };
}

export default function BillingWalletExpensesPage() {
  // The filters live in the address (?status=&from=&to=&template=...), which needs a Suspense boundary.
  return (
    <Suspense>
      <ExpensesPage />
    </Suspense>
  );
}
