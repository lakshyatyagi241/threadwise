import { notFound } from 'next/navigation';
import { TemplateDetailScreen } from '@/features/message-templates/components/detail-screen';

import { apiBaseUrl } from '@/features/message-templates/lib/curl';

export const dynamic = 'force-dynamic';

/** The public address of the customer API, as the Developers page shows it. */
const publicApiOrigin = () =>
  process.env.PUBLIC_API_URL ??
  process.env.APP_URL ??
  process.env.API_URL ??
  'http://localhost:3000';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <TemplateDetailScreen id={id} apiBaseUrl={apiBaseUrl(publicApiOrigin())} />;
}
