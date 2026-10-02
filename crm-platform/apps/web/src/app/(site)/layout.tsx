import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { legalPublicListResponseSchema, publicContentResponseSchema } from '@crm/contracts';
import { cmsPublic } from '@/features/marketing-site-cms/public/api';

/** The public site frame: header, content and a footer that lists the legal pages that are visible. */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('marketing-site-cms.site');
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
            {brand} {t('rights')}
          </span>
          {legal?.data.map((p) => (
            <Link key={p.slug} href={`/legal/${p.slug}`} className="hover:underline">
              {p.title}
            </Link>
          ))}
        </div>
      </footer>
    </div>
  );
}
