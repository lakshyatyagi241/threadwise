import type { Metadata } from 'next';
import { AppointmentsProviders } from '@/features/appointments/components/providers';
import { PublicBooking } from '@/features/appointments/components/public-booking';

/** The visitor's booking page for one service: pick a time, give details, confirm. Outside the app shell, never indexed. */
export const metadata: Metadata = {
  title: 'Book an appointment',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ org: string; slug: string }>;
}) {
  const { org, slug } = await params;
  return (
    <AppointmentsProviders>
      <PublicBooking org={org} slug={slug} />
    </AppointmentsProviders>
  );
}
