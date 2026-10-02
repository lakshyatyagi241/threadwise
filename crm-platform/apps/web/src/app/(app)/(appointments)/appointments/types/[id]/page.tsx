import { notFound } from 'next/navigation';
import { BookingTypeEditor } from '@/features/appointments/components/booking-type-editor';

const ID = /^[0-9A-Za-z_-]{1,64}$/;

export default async function EditBookingTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) notFound();
  return <BookingTypeEditor id={id} />;
}
