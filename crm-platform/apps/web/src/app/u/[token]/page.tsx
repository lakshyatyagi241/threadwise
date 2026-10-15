import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UnsubscribePage } from '@/features/contact-consent/components/unsubscribe-page';

/** The email unsubscribe page: outside the app shell, no session, never indexed. The address is the credential. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contact-consent.unsubscribe');
  return {
    title: t('title'),
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  };
}

export default async function UnsubscribeRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <UnsubscribePage token={token} />;
}
