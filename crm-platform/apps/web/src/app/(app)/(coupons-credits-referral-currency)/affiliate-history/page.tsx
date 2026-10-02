import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AffiliateHistoryPage } from '@/features/coupons-credits-referral-currency/affiliate/components/history-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.affiliate.history');
  return { title: t('title') };
}

/** Affiliate history (TW-CPN-035/036). */
export default function AffiliateHistoryRoute() {
  return <AffiliateHistoryPage />;
}
