import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WorkspaceDetailPage } from '@/features/wallet-message-billing/components/admin/workspace-detail-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('wallet-message-billing.admin.nav');
  return { title: t('workspaces') };
}

export default async function OperatorWalletWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkspaceDetailPage id={id} />;
}
