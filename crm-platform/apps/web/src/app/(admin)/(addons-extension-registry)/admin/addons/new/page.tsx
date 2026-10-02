import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PackFormPage } from '@/features/addons-extension-registry/components/pack-form-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addons-extension-registry.packs');
  return { title: t('new') };
}

export default function NewAddonPage() {
  return <PackFormPage />;
}
