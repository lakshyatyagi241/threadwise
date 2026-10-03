import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SwitchWizard } from '@/features/whatsapp-providers/components/switch-wizard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('whatsapp-providers.switch');
  return { title: t('title') };
}

/** `?from=<providerId>` starts on that provider; `?workspace=<workspaceId>` limits the channel list to one workspace. */
export default async function OperatorWhatsappSwitchPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; workspace?: string }>;
}) {
  const { from, workspace } = await searchParams;
  return <SwitchWizard initialFrom={from} workspaceId={workspace} />;
}
