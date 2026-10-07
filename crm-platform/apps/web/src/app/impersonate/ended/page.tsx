import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/** Where a spent, expired or malformed handoff link ends up: say so plainly and point back at the operator console. */
export default async function ImpersonationEndedPage({
  searchParams,
}: {
  searchParams: Promise<{ why?: string }>;
}) {
  const t = await getTranslations('workspaces-teams-tenancy.impersonation.ended');
  const { why } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">
        {why === 'invalid' ? t('expired') : t('body')}
      </p>
      <Link
        href="/admin/workspaces"
        className="inline-flex h-9 w-fit items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('back')}
      </Link>
    </main>
  );
}
