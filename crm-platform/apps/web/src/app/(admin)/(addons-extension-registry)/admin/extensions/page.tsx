import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ExtensionsPage } from '@/features/addons-extension-registry/components/extensions-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addons-extension-registry.extensions');
  return { title: t('title') };
}

export default function OperatorExtensionsPage() {
  return <ExtensionsPage />;
}
