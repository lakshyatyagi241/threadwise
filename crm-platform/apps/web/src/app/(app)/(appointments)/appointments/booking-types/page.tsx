import { redirect } from 'next/navigation';

/** Reference's address of the booking types list (`/appointments/booking-types`) lands on ours. */
export default function BookingTypesAlias() {
  redirect('/appointments/types');
}
