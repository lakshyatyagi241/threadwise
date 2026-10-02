import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { PacksPage } from '@/features/addons-extension-registry/components/packs-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addons-extension-registry.packs');
  return { title: t('title') };
}

export default function OperatorAddonsPage() {
  return (
    <Suspense>
      <PacksPage />
    </Suspense>
  );
}
