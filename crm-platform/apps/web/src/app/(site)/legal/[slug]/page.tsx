import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isLegalSlug, legalPagePublicSchema } from '@crm/contracts';
import { cmsPublic } from '@/features/marketing-site-cms/public/api';

type Props = { params: Promise<{ slug: string }> };

const load = async (slug: string) =>
  isLegalSlug(slug) ? cmsPublic(`/legal/${slug}`, legalPagePublicSchema) : null;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await load((await params).slug);
  return page ? { title: page.title, description: page.subtitle ?? undefined } : {};
}

/** A legal document (TW-CMS-013): table of contents, numbered sections whose anchor is `#sec-<n>`. */
export default async function LegalPage({ params }: Props) {
  const page = await load((await params).slug);
  if (!page) notFound();
  const t = await getTranslations('marketing-site-cms.site');
  return (
    <div className="cms-wrap cms-page">
      <article className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
          {page.subtitle && <p className="text-muted-foreground">{page.subtitle}</p>}
          <p className="text-xs text-muted-foreground">
            {page.updatedLabel && `${t('updated')}: ${page.updatedLabel}`}
            {page.updatedLabel && page.effectiveLabel && ' · '}
            {page.effectiveLabel && `${t('effective')}: ${page.effectiveLabel}`}
          </p>
        </header>
        <nav aria-label={t('onThisPage')} className="rounded-md border border-border p-4">
          <p className="mb-2 text-sm font-semibold">{t('onThisPage')}</p>
          <ol className="space-y-1 text-sm">
            {page.sections.map((s) => (
              <li key={s.n}>
                <a href={`#sec-${s.n}`} className="underline">
                  {s.n}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {page.sections.map((s) => (
          <section key={s.n} id={`sec-${s.n}`} className="scroll-mt-6 space-y-2">
            <h2 className="text-xl font-semibold">
              {s.n}. {s.title}
            </h2>
            <div
              className="space-y-3 leading-relaxed [&_a]:underline [&_ol]:list-decimal [&_ol]:ps-6 [&_ul]:list-disc [&_ul]:ps-6"
              dangerouslySetInnerHTML={{ __html: s.body }}
            />
          </section>
        ))}
      </article>
    </div>
  );
}
