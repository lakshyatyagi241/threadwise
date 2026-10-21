import { notFound } from 'next/navigation';
import { TypeAppearanceScreen } from '@/features/appointments/components/appearance-screen';

const ID = /^[0-9A-Za-z_-]{1,64}$/;

export default async function BookingTypeAppearancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!ID.test(id)) notFound();
  return <TypeAppearanceScreen id={id} />;
}
