import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/** The unknown-address page of the signed-in app: drawn inside the shell, with a link back to the dashboard. */
export default async function AppNotFound() {
  const t = await getTranslations('admin-console-shell.notFound');
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('body')}</p>
      <Link
        href="/"
        className="mt-2 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {t('home')}
      </Link>
    </div>
  );
}
