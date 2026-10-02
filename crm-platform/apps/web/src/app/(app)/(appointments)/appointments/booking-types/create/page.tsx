import { redirect } from 'next/navigation';

/** WaDesk's address of the new booking type wizard lands on ours. */
export default function BookingTypeCreateAlias() {
  redirect('/appointments/types/new');
}
