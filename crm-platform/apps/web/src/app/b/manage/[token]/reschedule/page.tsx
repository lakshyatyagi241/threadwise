import type { Metadata } from 'next';
import { AppointmentsProviders } from '@/features/appointments/components/providers';
import { PublicReschedule } from '@/features/appointments/components/public-reschedule';

/** WaDesk's reschedule page (same address): pick another time for the booking behind the secret link. */
export const metadata: Metadata = {
  title: 'Reschedule booking',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function PublicReschedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <AppointmentsProviders>
      <PublicReschedule token={token} />
    </AppointmentsProviders>
  );
}
