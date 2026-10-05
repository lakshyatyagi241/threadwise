import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NewSourcePage } from '@/features/lead-sources/components/new-source-page';
import { hookEnvFromProcess } from '@/features/lead-sources/lib/hook-url';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('lead-sources.wizard');
  return { title: t('title') };
}

export default function NewLeadSourcePage() {
  // The public address of the hook comes from the server's environment (runtime values win over build-time ones).
  return <NewSourcePage hookEnv={hookEnvFromProcess()} />;
}
