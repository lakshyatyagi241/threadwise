import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PublicInvoice } from '@/features/invoicing/components/public-invoice';

/** The buyer's page. Never indexed, never cached by a shared cache: the link is the only credential (D-15). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invoicing.public');
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  };
}

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicInvoice token={token} />;
}
