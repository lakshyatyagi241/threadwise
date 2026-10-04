import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isLegalSlug, legalPagePublicSchema, publicSiteInfoSchema } from '@crm/contracts';
import { cmsPublic } from '@/features/marketing-site-cms/public/api';

type Props = { params: Promise<{ slug: string }> };

const load = async (slug: string) =>
  isLegalSlug(slug) ? cmsPublic(`/legal/${slug}`, legalPagePublicSchema) : null;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await load((await params).slug);
  return page ? { title: page.title, description: page.subtitle ?? undefined } : {};
}

/** A legal document (WD-CMS-013): hero, contents sidebar and numbered sections whose anchor is `#sec-<n>`. */
export default async function LegalPage({ params }: Props) {
  const page = await load((await params).slug);
  if (!page) notFound();
  const t = await getTranslations('marketing-site-cms.site');
  const info = await cmsPublic('/site-info', publicSiteInfoSchema);
  const email = info?.emailSupport ?? '';
  const chip = 'hairline inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5';
  return (
    <>
      <section className="relative overflow-hidden bg-paper-0">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-30" />
        <div className="blur-bub absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full bg-wa-mint/40" />
        <div className="relative mx-auto max-w-[1080px] px-4 py-24 sm:px-6 lg:px-7">
          <span className="badge-num mb-6 inline-block">— {t('legalTitle')}</span>
          <h1 className="serif text-[40px] leading-[0.92] tracking-[-0.025em] sm:text-[56px] lg:text-[88px]">
            {page.title}
          </h1>
          {page.subtitle && (
            <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-700">
              {page.subtitle}
            </p>
          )}
          <div className="mono mt-8 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-widest text-ink-500">
            {page.updatedLabel && (
              <span className={chip}>
                <span className="h-1.5 w-1.5 rounded-full bg-wa-green" />
                {t('updated')} · {page.updatedLabel}
              </span>
            )}
            {page.effectiveLabel && (
              <span className={`${chip} text-wa-deep`}>
                {t('effective')} · {page.effectiveLabel}
              </span>
            )}
            <span className={chip}>
              {t('readTime')} · {page.readMinutes} {t('min')}
            </span>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-[1360px] grid-cols-1 gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:px-7">
          <aside className="col-span-12 lg:col-span-3">
            <div className="lg:sticky lg:top-24">
              <div className="mono mb-4 text-[10px] uppercase tracking-widest text-ink-500">
                {t('contents')}
              </div>
              <ol className="space-y-2.5" aria-label={t('onThisPage')}>
                {page.sections.map((s) => (
                  <li key={s.n}>
                    <a
                      href={`#sec-${s.n}`}
                      className="flex gap-3 text-[12.5px] text-ink-700 hover:text-wa-deep"
                    >
                      <span className="serif w-6 shrink-0 text-wa-deep">{s.n}</span>
                      <span>{s.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
              {email && (
                <div className="hairline mt-8 rounded-2xl bg-paper-50 p-4">
                  <div className="mono mb-2 text-[10px] uppercase tracking-widest text-ink-500">
                    {t('questions')}
                  </div>
                  <p className="text-[12px] leading-relaxed text-ink-700">
                    {t('emailUs')}{' '}
                    <a href={`mailto:${email}`} className="font-semibold text-wa-deep">
                      {email}
                    </a>
                  </p>
                </div>
              )}
            </div>
          </aside>
          <article className="legal-prose col-span-12 lg:col-span-9">
            {page.sections.map((s) => (
              <section key={s.n} id={`sec-${s.n}`} className="reveal mb-16 scroll-mt-24">
                <div className="hairline-b mb-5 flex items-baseline gap-5 pb-4">
                  <span className="serif text-[40px] leading-none text-wa-deep">{s.n}</span>
                  <h2 className="serif text-[36px] leading-none">{s.title}</h2>
                </div>
                <div
                  className="prose-body text-[14.5px] leading-[1.7] text-ink-800"
                  dangerouslySetInnerHTML={{ __html: s.body }}
                />
              </section>
            ))}
            <div className="hairline-t mono mt-12 pt-8 text-[12px] text-ink-500">
              {t('documentVersion')} · {page.updatedLabel ?? t('current')}
              {email && (
                <>
                  {' · '}
                  <a href={`mailto:${email}`} className="text-wa-deep">
                    {email}
                  </a>
                </>
              )}
            </div>
          </article>
        </div>
      </section>
    </>
  );
}
