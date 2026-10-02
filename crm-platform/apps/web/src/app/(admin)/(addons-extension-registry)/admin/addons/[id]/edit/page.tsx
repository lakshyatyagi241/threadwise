import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PackFormPage } from '@/features/addons-extension-registry/components/pack-form-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addons-extension-registry.packs.editor');
  return { title: t('crumbEdit') };
}

export default async function EditAddonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PackFormPage packId={id} />;
}
