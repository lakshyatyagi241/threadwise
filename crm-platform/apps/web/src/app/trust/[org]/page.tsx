import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TrustPage, loadTrustPage } from '@/features/compliance-center/components/trust-page';

/** A workspace's public sub-processor page: outside the app shell, no session. Only a workspace that switched it on has one. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string }>;
}): Promise<Metadata> {
  const { org } = await params;
  const page = await loadTrustPage(org);
  const t = await getTranslations('compliance-center.trust');
  return {
    title: page ? t('title', { workspace: page.workspaceName }) : t('notFound'),
    referrer: 'no-referrer',
  };
}

export default async function TrustRoute({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return <TrustPage slug={org} />;
}
