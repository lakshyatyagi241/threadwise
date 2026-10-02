import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountFrame } from '@/features/auth-registration-security/shared/account-hub';
import { AffiliatePane } from '@/features/coupons-credits-referral-currency/affiliate/components/account-pane';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.affiliate.pane');
  return { title: t('title') };
}

/** The account hub's Affiliate pane (TW-CPN-037), drawn inside the shared frame. */
export default function AffiliatePanePage() {
  return (
    <AccountFrame>
      <AffiliatePane />
    </AccountFrame>
  );
}
