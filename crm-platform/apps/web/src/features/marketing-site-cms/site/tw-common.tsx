import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { CMS_KEYS, type CmsSection } from '@crm/contracts';
import { PricingCards, type FallbackTier } from './pricing-strip';
import { T, type SiteCtx } from './site-ui';

/** The content key of one field of a section on the page being rendered. */
export const keyOf = (ctx: SiteCtx, slug: string, field: string) => `${ctx.page}.${slug}.${field}`;

/** A reveal delay as the inline style the reveal animation reads. */
export const vd = (delay: string): CSSProperties => ({ ['--d' as string]: delay });

/** The key builder and editor link-attribute helper of one section. */
export const mk = (ctx: SiteCtx, slug: string) => ({
  k: (field: string) => keyOf(ctx, slug, field),
  u: (field: string): Record<string, string> =>
    ctx.edit ? { 'data-fc-url': keyOf(ctx, slug, field) } : {},
  a: (field: string): Record<string, string> =>
    ctx.edit
      ? {
          'data-fc': keyOf(ctx, slug, field),
          'data-fc-type': CMS_KEYS.get(keyOf(ctx, slug, field))?.type ?? 'text',
        }
      : {},
});

/** True when a field has text, or the editor is open (so empty fields stay clickable). */
export const has = (ctx: SiteCtx, slug: string, field: string) =>
  ctx.edit || ctx.fc(keyOf(ctx, slug, field)) !== '';

export const Arrow = ({ className = 'h-3.5 w-3.5' }: { className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden
  >
    <path d="M5 4l4 4-4 4" />
  </svg>
);

/** A small bordered label with a leading dash ("— Pricing"). */
export function Badge({
  ctx,
  k,
  as: As = 'div',
  className = 'mb-6',
}: {
  ctx: SiteCtx;
  k: string;
  as?: 'div' | 'span';
  className?: string;
}) {
  if (ctx.fc(k) === '' && !ctx.edit) return null;
  return (
    <As className={`badge-num ${className}`}>
      — <T ctx={ctx} k={k} />
    </As>
  );
}

/** The Reference page opener: grid paper, a mint glow, an eyebrow badge, a big serif headline and an intro. */
export function PageHero({ ctx, def }: { ctx: SiteCtx; def: CmsSection }) {
  const k = (f: string) => keyOf(ctx, def.slug, f);
  return (
    <section className="relative overflow-hidden bg-paper-0" data-section={def.slug} id={def.slug}>
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-30" />
      <div className="blur-bub absolute -end-32 -top-32 h-[520px] w-[520px] rounded-full bg-wa-mint/50" />
      <div className="relative mx-auto max-w-[1360px] px-4 py-20 sm:px-7 lg:py-28">
        <Badge ctx={ctx} k={k('eyebrow')} />
        <T
          ctx={ctx}
          k={k('headline')}
          as="h1"
          className="serif text-[44px] leading-[0.95] tracking-[-0.02em] sm:text-[64px] lg:text-[88px] lg:leading-[0.92]"
        />
        <T
          ctx={ctx}
          k={k('intro')}
          as="p"
          className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-ink-700"
        />
      </div>
    </section>
  );
}

/** Pricing: the section header (homepage only), the cards from the plan catalogue and the reassurance strip. */
export function PricingSection({ ctx, def }: { ctx: SiteCtx; def: CmsSection }) {
  const slug = def.slug;
  const k = (f: string) => keyOf(ctx, slug, f);
  const header = def.fields.some((f) => f.key === 'label');
  const tiers: FallbackTier[] = [1, 2, 3].map((i) => {
    const list = (p: string, n: number) =>
      Array.from({ length: n }, (_, j) => ctx.fc(k(`tier${i}_${p}${j + 1}`)));
    return {
      num: ctx.fc(k(`tier${i}_num`)),
      name: ctx.fc(k(`tier${i}_name`)),
      badge: ctx.fc(k(`tier${i}_badge`)),
      tagline: ctx.fc(k(`tier${i}_tagline`)),
      price: ctx.fc(k(`tier${i}_price`)),
      period: ctx.fc(k(`tier${i}_period`)),
      overage: ctx.fc(k(`tier${i}_overage`)),
      ctaLabel: ctx.fc(k(`tier${i}_cta_label`)),
      volume: list('volume', 3),
      features: list('feature', 3),
      support: list('support', 2),
    };
  });
  return (
    <section className="bg-white" data-section={slug} id={slug}>
      <div className="mx-auto max-w-[1360px] px-4 py-20 sm:px-7 lg:py-28">
        {header && (
          <>
            <div className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-12">
              <div className="col-span-12 lg:col-span-2">
                <div className="feature-num text-[80px] sm:text-[140px]">10</div>
              </div>
              <div className="col-span-12 flex flex-col justify-end pb-3 lg:col-span-3">
                <div className="mono mb-1 text-[10px] uppercase tracking-[0.22em] text-ink-500">
                  — <T ctx={ctx} k={k('eyebrow_text')} />
                </div>
                <T ctx={ctx} k={k('label')} as="div" className="text-[13px] font-semibold" />
              </div>
              <div className="mono col-span-12 flex flex-wrap items-end gap-3 pb-3 text-[11px] text-ink-500 lg:col-span-7 lg:justify-end">
                <T ctx={ctx} k={k('meta1')} />
                <span className="text-ink-400">·</span>
                <T ctx={ctx} k={k('meta2')} />
                <span className="text-ink-400">·</span>
                <T ctx={ctx} k={k('meta3')} className="text-wa-deep" />
              </div>
            </div>
            <T
              ctx={ctx}
              k={k('headline')}
              as="h2"
              className="serif reveal mb-12 text-[44px] leading-[0.92] tracking-[-0.02em] sm:text-[64px] lg:text-[88px]"
            />
          </>
        )}
        <PricingCards
          pricing={ctx.extras.pricing ?? null}
          tiers={tiers}
          labels={{
            monthly: ctx.fc(k('monthly_label')),
            yearly: ctx.fc(k('yearly_label')),
            save: ctx.fc(k('save_label')),
          }}
        />
        {header && (
          <div className="hairline mt-10 grid grid-cols-1 items-center gap-6 rounded-2xl bg-paper-50 px-6 py-5 lg:grid-cols-12">
            <div className="mono col-span-12 text-[10px] uppercase tracking-[0.22em] text-ink-500 lg:col-span-3">
              — <T ctx={ctx} k={k('honest_label_text')} />
            </div>
            <div className="col-span-12 grid grid-cols-2 gap-4 text-[12px] lg:col-span-9 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-wa-deep">✓</span>
                  <T ctx={ctx} k={k(`honest${i}`)} className="text-ink-700 [&_span]:text-ink-500" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

const PlusMinus = () => (
  <span className="hairline flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition group-open:bg-wa-deep group-open:text-paper-0">
    <svg
      viewBox="0 0 16 16"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M3 8h10" />
      <path d="M8 3v10" className="group-open:hidden" />
    </svg>
  </span>
);

/** The page's own questions (`faqN_q` / `faqN_a`), or the pricing FAQ table when it has rows for this page. */
export function FaqSection({ ctx, def }: { ctx: SiteCtx; def: CmsSection }) {
  const slug = def.slug;
  const n = def.fields.filter((f) => /^faq\d+_q$/.test(f.key)).length;
  const table = ctx.extras.tableFaqs ?? [];
  const own = Array.from({ length: n }, (_, i) => i + 1).filter((i) => has(ctx, slug, `faq${i}_q`));
  const items: Array<{ id: string; q: ReactNode; a: ReactNode }> =
    table.length > 0 && !ctx.edit
      ? table.map((f) => ({ id: f.id, q: f.question, a: f.answer }))
      : own.map((i) => ({
          id: String(i),
          q: <T ctx={ctx} k={keyOf(ctx, slug, `faq${i}_q`)} />,
          a: <T ctx={ctx} k={keyOf(ctx, slug, `faq${i}_a`)} />,
        }));
  return (
    <section className="hairline-t hairline-b bg-paper-50" data-section={slug} id={slug}>
      <div className="mx-auto max-w-[1080px] px-4 py-20 sm:px-6 lg:px-7 lg:py-28">
        <div className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="col-span-12 lg:col-span-4">
            <Badge ctx={ctx} k={keyOf(ctx, slug, 'kicker')} className="" />
            <T
              ctx={ctx}
              k={keyOf(ctx, slug, 'headline')}
              as="h2"
              className="serif mt-4 text-[40px] leading-[0.95] sm:text-[52px] lg:text-[64px]"
            />
            <T
              ctx={ctx}
              k={keyOf(ctx, slug, 'subtitle')}
              as="p"
              className="mt-3 text-[13px] text-ink-600"
            />
          </div>
          <div className="reveal col-span-12 lg:col-span-8" style={{ ['--d' as string]: '120ms' }}>
            <div className="hairline divide-y divide-paper-200 rounded-2xl bg-white">
              {items.map((it, idx) => (
                <details key={it.id} className="details group p-5" open={idx === 0}>
                  <summary className="flex items-center justify-between gap-4">
                    <span className="text-[15px] font-medium">{it.q}</span>
                    <PlusMinus />
                  </summary>
                  <p className="mt-3 text-[13px] leading-relaxed text-ink-600">{it.a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The homepage FAQ marquee (TW-CMS-010): the FAQ table's home rows scrolling in two rows; nothing when there are none. */
export function FaqSlider({ ctx, def }: { ctx: SiteCtx; def: CmsSection }) {
  const faqs = ctx.extras.homeFaqs ?? [];
  const slug = def.slug;
  if (faqs.length === 0 && !ctx.edit) return null;
  const half = Math.ceil(faqs.length / 2);
  const rowsOf = faqs.length > 3 ? [faqs.slice(0, half), faqs.slice(half)] : [faqs];
  return (
    <section className="bg-white py-20 lg:py-28" data-section={slug} id={slug}>
      <div className="mx-auto max-w-[1360px] px-4 sm:px-7">
        <div className="mb-10 max-w-2xl">
          <Badge ctx={ctx} k={keyOf(ctx, slug, 'kicker')} className="" />
          <T
            ctx={ctx}
            k={keyOf(ctx, slug, 'headline')}
            as="h2"
            className="serif mt-4 text-[40px] leading-[0.95] sm:text-[52px] lg:text-[64px]"
          />
          <T
            ctx={ctx}
            k={keyOf(ctx, slug, 'subtitle')}
            as="p"
            className="mt-3 text-[13px] text-ink-600"
          />
        </div>
      </div>
      <div className="space-y-4">
        {rowsOf.map((row, r) => {
          const loop = [...row, ...row, ...row, ...row];
          return (
            <div key={r} className="tw-faq-marquee tw-faq-mask">
              <div className={`tw-faq-track${r === 1 ? ' rev' : ''}`}>
                {loop.map((f, i) => (
                  <div
                    key={`${f.id}-${i}`}
                    className="tw-faq-card"
                    aria-hidden={i >= row.length ? true : undefined}
                  >
                    <div className="text-[14px] font-semibold">{f.question}</div>
                    <p className="tw-faq-answer mt-1.5 text-[12.5px] leading-relaxed text-ink-600">
                      {f.answer}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The closing banner: a deep gradient card with the call to action buttons. */
export function CtaFinal({ ctx, def }: { ctx: SiteCtx; def: CmsSection }) {
  const slug = def.slug;
  const k = (f: string) => keyOf(ctx, slug, f);
  const href = (f: string, dflt: string) => ctx.fc(k(f)) || dflt;
  return (
    <section
      className="mx-auto max-w-[1360px] px-4 py-20 sm:px-6 lg:px-7 lg:py-28"
      data-section={slug}
      id={slug}
    >
      <div className="reveal relative overflow-hidden rounded-[36px] bg-gradient-to-br from-wa-deep via-wa-teal to-ink-950 px-6 py-12 text-paper-0 sm:px-10 sm:py-16 lg:px-12 lg:py-20">
        <div className="dot-pattern absolute inset-0 opacity-20" />
        <div className="blur-bub absolute -bottom-32 -end-32 h-[400px] w-[400px] rounded-full bg-wa-green/20" />
        <div className="relative max-w-3xl">
          <T
            ctx={ctx}
            k={k('kicker')}
            as="div"
            className="mono mb-4 text-[10px] uppercase tracking-[0.22em] text-paper-0/60"
          />
          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif em-green text-[44px] leading-[0.92] tracking-[-0.02em] sm:text-[64px] lg:text-[100px]"
          />
          <T
            ctx={ctx}
            k={k('subtitle')}
            as="p"
            className="mt-6 max-w-xl text-[16px] text-paper-0/80"
          />
          <div className="mt-8 flex flex-wrap gap-3">
            {has(ctx, slug, 'cta_label') && (
              <Link
                href={href('cta_url', '/register')}
                {...(ctx.edit ? { 'data-fc-url': k('cta_url') } : {})}
                className="glow-green flex items-center gap-2 rounded-full bg-wa-green px-6 py-3.5 text-[14px] font-semibold text-ink-900 hover:bg-[#1ec05a]"
              >
                <T ctx={ctx} k={k('cta_label')} />
                <Arrow />
              </Link>
            )}
            {has(ctx, slug, 'cta2_label') && (
              <Link
                href={href('cta2_url', '/contact')}
                {...(ctx.edit ? { 'data-fc-url': k('cta2_url') } : {})}
                className="hairline rounded-full border-paper-0/30 px-6 py-3.5 text-[14px] font-medium hover:bg-paper-0/10"
              >
                <T ctx={ctx} k={k('cta2_label')} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
