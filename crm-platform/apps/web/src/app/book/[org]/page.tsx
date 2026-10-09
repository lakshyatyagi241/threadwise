import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AppointmentsProviders } from '@/features/appointments/components/providers';
import { PublicDirectory } from '@/features/appointments/components/public-directory';

/**
 * The visitor's service chooser. It lives outside the app shell (no menu, no session) and is never indexed; `next.config.ts`
 * adds `Cache-Control: no-store` and `Referrer-Policy: no-referrer` to everything under /book.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('appointments.public.meta');
  return {
    title: t('book'),
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  };
}

export default async function PublicDirectoryPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  return (
    <AppointmentsProviders>
      <PublicDirectory org={org} />
    </AppointmentsProviders>
  );
}
