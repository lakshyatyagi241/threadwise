import { notFound } from 'next/navigation';
import { TemplateDetailScreen } from '@/features/message-templates/components/detail-screen';

import { publicApiOrigin } from '@/lib/public-api-origin';
import { apiBaseUrl } from '@/features/message-templates/lib/curl';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <TemplateDetailScreen id={id} apiBaseUrl={apiBaseUrl(publicApiOrigin())} />;
}
