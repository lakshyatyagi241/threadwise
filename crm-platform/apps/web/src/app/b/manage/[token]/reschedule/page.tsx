import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AppointmentsProviders } from '@/features/appointments/components/providers';
import { PublicReschedule } from '@/features/appointments/components/public-reschedule';

/** Reference's reschedule page (same address): pick another time for the booking behind the secret link. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('appointments.public.meta');
  return {
    title: t('reschedule'),
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  };
}

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
