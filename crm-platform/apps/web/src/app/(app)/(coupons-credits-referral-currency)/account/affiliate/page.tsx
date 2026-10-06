import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountFrame } from '@/features/auth-registration-security/shared/account-hub';
import { AffiliatePage } from '@/features/coupons-credits-referral-currency/components/affiliate/affiliate-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('coupons-credits-referral-currency.affiliate');
  return { title: t('title') };
}

/** Affiliate (TW-CPN-035..037): a pane of the account hub, drawn inside the shared frame. */
export default function AffiliateAccountPage() {
  return (
    <AccountFrame>
      <AffiliatePage />
    </AccountFrame>
  );
}
