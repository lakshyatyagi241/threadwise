import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { uuidSchema } from '@crm/contracts';
import { WorkspaceDetailPage } from '@/features/workspaces-hub';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workspaces-hub.detail');
  return { title: t('crumb') };
}

export default async function OperatorWorkspaceRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  return <WorkspaceDetailPage id={id} />;
}
