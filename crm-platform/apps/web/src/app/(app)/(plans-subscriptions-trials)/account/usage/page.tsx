import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountFrame } from '@/features/auth-registration-security/shared/account-hub';
import { UsagePanel } from '@/features/plans-subscriptions-trials/components/usage-panel';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('plans-subscriptions-trials.usage');
  return { title: t('title') };
}

/** Plan and usage (WD-PLAN-014): a pane of the account hub, drawn inside the shared frame. */
export default function UsagePage() {
  return (
    <AccountFrame>
      <UsagePanel />
    </AccountFrame>
  );
}
