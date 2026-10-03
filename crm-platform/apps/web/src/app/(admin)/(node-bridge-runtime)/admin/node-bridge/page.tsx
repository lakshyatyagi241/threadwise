import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NodeBridgePage } from '@/features/node-bridge-runtime/node-bridge-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('node-bridge-runtime.page');
  return { title: t('title') };
}

export default function OperatorNodeBridgePage() {
  return <NodeBridgePage />;
}
