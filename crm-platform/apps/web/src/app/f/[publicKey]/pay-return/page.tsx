import type { Metadata } from 'next';
import { PayReturn } from '@/features/web-forms/public/pay-return';
import { fetchPublicForm } from '@/features/web-forms/public/server';
import { UnavailableForm } from '@/features/web-forms/public/unavailable';
import { SUBMISSION_TOKEN } from '@/features/web-forms/lib/public-paths';

/**
 * Where the payment gateway sends a visitor after paying. Never indexed. It does not trust the redirect: it asks the API where the
 * payment stands (set by the gateway's verified notification) and shows the form's thank-you only once it is paid.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function PayReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicKey: string }>;
  searchParams: Promise<{ s?: string | string[] }>;
}) {
  const [{ publicKey }, query] = await Promise.all([params, searchParams]);
  const token = typeof query.s === 'string' ? query.s : '';
  if (!SUBMISSION_TOKEN.test(token)) return <UnavailableForm kind="missing" />;
  const result = await fetchPublicForm(publicKey);
  if (result.status === 'missing') return <UnavailableForm kind="missing" />;
  if (result.status === 'unavailable') return <UnavailableForm kind="error" />;
  return <PayReturn form={result.form} token={token} />;
}
