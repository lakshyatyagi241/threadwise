import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SwitchPage } from '@/features/whatsapp-providers/components/switch-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('whatsapp-providers.switch');
  return { title: t('title') };
}

/** `?workspace=<id>&name=<name>` starts on that workspace; `?target=<providerId>` starts with that target provider. */
export default async function OperatorWhatsappSwitchPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; name?: string; target?: string }>;
}) {
  const { workspace, name, target } = await searchParams;
  return <SwitchPage workspaceId={workspace} workspaceName={name} targetId={target} />;
}
