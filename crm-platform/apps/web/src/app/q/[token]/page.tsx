import type { Metadata } from 'next';
import { PublicQuote, SalesDocsProviders } from '@/features/sales-docs';

/**
 * The buyer's page. It lives outside the app shell (no menu, no session) and is never indexed: it holds a customer's name and
 * prices, and its address is the credential. `next.config.ts` adds `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
 */
export const metadata: Metadata = {
  title: 'Quote',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <SalesDocsProviders>
      <PublicQuote token={token} />
    </SalesDocsProviders>
  );
}
