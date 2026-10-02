import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { setupStatusResponseSchema } from '@crm/contracts';
import { SetupWizard } from '@/features/install-update-licensing/setup/setup-wizard';
import { apiBase } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('install-update-licensing.setup');
  return { title: t('title') };
}

/** Once setup is complete the page is gone: anyone landing here is sent to sign-in. */
export default async function SetupPage() {
  const t = await getTranslations('install-update-licensing.setup');
  let status;
  try {
    const res = await fetch(`${apiBase()}/v2/setup/status`, { cache: 'no-store' });
    status = setupStatusResponseSchema.parse(await res.json());
  } catch {
    return (
      <p
        role="alert"
        className="relative z-10 max-w-md rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger"
      >
        {t('unavailable')}
      </p>
    );
  }
  if (status.state === 'completed') redirect('/login');
  return <SetupWizard status={status} />;
}
