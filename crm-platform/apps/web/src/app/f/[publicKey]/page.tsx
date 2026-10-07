import type { Metadata } from 'next';
import { PublicForm } from '@/features/web-forms/public/public-form';
import { fetchPublicForm } from '@/features/web-forms/public/server';
import { UnavailableForm } from '@/features/web-forms/public/unavailable';

/**
 * The hosted form and its embedded frame. Outside the app shell, never indexed, and its address is its only identifier. The frame
 * policy is set per form in `src/proxy.ts`; `next.config.ts` adds `no-store` and `no-referrer`.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicKey: string }>;
  searchParams: Promise<{ embed?: string | string[] }>;
}) {
  const [{ publicKey }, query] = await Promise.all([params, searchParams]);
  const result = await fetchPublicForm(publicKey);
  if (result.status === 'missing') return <UnavailableForm kind="missing" />;
  if (result.status === 'unavailable') return <UnavailableForm kind="error" />;
  if (result.form.closed) return <UnavailableForm kind="closed" />;
  return <PublicForm form={result.form} embed={query.embed === '1'} />;
}
