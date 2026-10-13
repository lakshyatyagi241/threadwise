import { notFound } from 'next/navigation';
import { EditScreen } from '@/features/scheduled-queue-warmer/components/composer-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ScheduleEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <EditScreen id={id} />;
}
