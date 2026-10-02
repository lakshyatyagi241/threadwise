import type { Metadata } from 'next';
import { AppointmentsProviders } from '@/features/appointments/components/providers';
import { PublicManage } from '@/features/appointments/components/public-manage';

/**
 * Reference's manage page (same address): the booking behind a secret link, with Reschedule and Cancel. The link is the
 * credential, so the page is never cached, indexed or leaked through a Referer header.
 */
export const metadata: Metadata = {
  title: 'Your booking',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function PublicManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AppointmentsProviders>
      <PublicManage token={token} />
    </AppointmentsProviders>
  );
}
