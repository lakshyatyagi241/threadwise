import { notFound } from 'next/navigation';
import { DeviceDetailScreen } from '@/features/whatsapp-devices-baileys/components/device-detail-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <DeviceDetailScreen id={id} />;
}
