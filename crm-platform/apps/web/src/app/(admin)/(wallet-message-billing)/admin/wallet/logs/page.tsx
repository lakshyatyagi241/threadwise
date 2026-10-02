import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LogsPage } from '@/features/wallet-message-billing/components/admin/logs-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet-message-billing.admin.nav');
  return { title: t('logs') };
}

export default function OperatorLogsPageRoute() {
  return <LogsPage />;
}
