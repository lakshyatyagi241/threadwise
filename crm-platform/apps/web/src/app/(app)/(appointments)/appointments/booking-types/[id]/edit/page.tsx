import { redirect } from 'next/navigation';

/** WaDesk's address of the edit wizard (`/appointments/booking-types/{id}/edit`) lands on ours. */
export default async function BookingTypeEditAlias({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/appointments/types/${encodeURIComponent(id)}`);
}
