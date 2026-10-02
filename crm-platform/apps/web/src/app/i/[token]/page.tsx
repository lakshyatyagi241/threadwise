import type { Metadata } from 'next';
import { PublicInvoice } from '@/features/invoicing/components/public-invoice';

/** The buyer's page. Never indexed, never cached by a shared cache: the link is the only credential (D-15). */
export const metadata: Metadata = {
  title: 'Invoice',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicInvoice token={token} />;
}
