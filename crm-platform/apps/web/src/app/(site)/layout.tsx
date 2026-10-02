import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { legalPublicListResponseSchema, publicContentResponseSchema } from '@crm/contracts';
import { cmsPublic } from '@/features/marketing-site-cms/public/api';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';
import { PublicCustomCode } from '@/features/platform-settings-branding-storage/site/site-head';

/** The public site frame: header, content and a footer that lists the legal pages that are visible. */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('marketing-site-cms.site');
  const tc = await getTranslations('platform-settings-branding-storage.cookie');
  const site = await getSiteConfig();
  const [legal, content] = await Promise.all([
    cmsPublic('/legal', legalPublicListResponseSchema),
    cmsPublic('/content', publicContentResponseSchema),
  ]);
  const brand = content?.brandName ?? '';
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:rounded focus:bg-background focus:px-3 focus:py-2"
      >
        {t('skip')}
      </a>
      <header className="border-b border-border">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 sm:px-6">
          <Link href="/blog" className="me-auto text-lg font-semibold">
            {brand}
          </Link>
          <Link href="/blog" className="text-sm hover:underline">
            {t('blog')}
          </Link>
          <Link href="/contact" className="text-sm hover:underline">
            {t('contact')}
          </Link>
          <Link href="/login" className="text-sm font-medium hover:underline">
            {t('signIn')}
          </Link>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span className="me-auto">
            {site?.footer.title && (
              <strong className="me-2 text-foreground">{site.footer.title}</strong>
            )}
            {site?.footer.copyright || `${brand} ${t('rights')}`}
          </span>
          {site?.footer.social &&
            Object.entries(site.footer.social).map(([name, href]) => (
              <a key={name} href={href} rel="noopener noreferrer" className="hover:underline">
                {name}
              </a>
            ))}
          {legal?.data.map((p) => (
            <Link key={p.slug} href={`/legal/${p.slug}`} className="hover:underline">
              {p.title}
            </Link>
          ))}
          <a href="#cookie-preferences" data-cookie-prefs-open className="hover:underline">
            {tc('preferences')}
          </a>
        </div>
        {site?.footer.description && (
          <p className="mx-auto max-w-5xl px-4 pb-6 text-sm text-muted-foreground sm:px-6">
            {site.footer.description}
          </p>
        )}
      </footer>
      {site && <PublicCustomCode cfg={site} />}
    </div>
  );
}
