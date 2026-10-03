import { notFound } from 'next/navigation';
import { DetailScreen } from '@/features/scheduled-queue-warmer/components/detail-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <DetailScreen id={id} />;
}
