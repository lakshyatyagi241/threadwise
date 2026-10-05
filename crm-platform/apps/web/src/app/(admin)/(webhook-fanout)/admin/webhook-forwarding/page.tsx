import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WebhookForwardingPage } from '@/features/webhook-fanout';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('webhook-fanout.page');
  return { title: t('title') };
}

export default function OperatorWebhookForwardingPage() {
  return <WebhookForwardingPage />;
}
