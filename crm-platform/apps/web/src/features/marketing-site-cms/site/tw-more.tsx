import type { CmsSection } from '@crm/contracts';
import { T, type SiteCtx } from './site-ui';
import { has, mk, vd } from './tw-common';

interface P {
  ctx: SiteCtx;
  def: CmsSection;
}

export function UseCases({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-white">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-7 py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12">
            <div className="lg:col-span-2 min-w-0">
              <div className="feature-num text-[64px] sm:text-[96px] lg:text-[140px]">08</div>
            </div>
            <div className="lg:col-span-3 flex flex-col justify-end pb-3 min-w-0">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('label')} as="div" className="text-[13px] font-semibold" />
            </div>
            <div className="lg:col-span-7 flex flex-wrap items-end lg:justify-end pb-3 gap-3 text-[11px] mono text-ink-500 min-w-0">
              <T ctx={ctx} k={k('meta1')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta2')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta3')} as="span" className="text-wa-deep" />
            </div>
          </div>

          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif text-[40px] sm:text-[64px] lg:text-[88px] leading-[0.92] tracking-[-0.02em] mb-3 reveal"
          />

          <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-4 reveal" style={vd('120ms')}>
            {[1, 2, 3, 4].map((c) => (
              <div
                key={c}
                className="hairline rounded-3xl bg-paper-50 p-6 hover:border-wa-deep transition"
              >
                <div className="flex items-center gap-2 mb-4">
                  <span className="badge-num">{['i', 'ii', 'iii', 'iv'][c - 1]}</span>
                  <span className="mono text-[10px] uppercase tracking-widest text-ink-500">
                    {<T ctx={ctx} k={k(`case${c}_cat`)} as="span" />}
                  </span>
                </div>
                <h3 className="serif text-[28px] leading-tight">
                  {<T ctx={ctx} k={k(`case${c}_title`)} as="span" />}
                </h3>
                <ul className="mt-5 space-y-2 text-[12.5px] text-ink-700">
                  {[1, 2, 3, 4].map((i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-wa-deep">›</span>
                      {<T ctx={ctx} k={k(`case${c}_bullet${i}`)} as="span" />}
                    </li>
                  ))}
                </ul>
                {has(ctx, def.slug, `case${c}_uplift`) && (
                  <div className="mt-5 hairline-t pt-3 flex items-center justify-between">
                    <span className="mono text-[10px] text-ink-500">avg uplift</span>
                    <span className="serif text-[20px] text-wa-deep">
                      {<T ctx={ctx} k={k(`case${c}_uplift`)} as="span" />}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function Testimonials({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-paper-50 hairline-t hairline-b">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-7 py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12">
            <div className="col-span-12 lg:col-span-2">
              <div className="feature-num text-[80px] sm:text-[140px]">09</div>
            </div>
            <div className="col-span-12 lg:col-span-3 flex flex-col justify-end pb-3">
              <div className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1">
                — <T ctx={ctx} k={k('eyebrow_text')} as="span" />
              </div>
              <T ctx={ctx} k={k('label')} as="div" className="text-[13px] font-semibold" />
            </div>
            <div className="col-span-12 lg:col-span-7 flex flex-wrap items-end lg:justify-end pb-3 gap-3 text-[11px] mono text-ink-500">
              <T ctx={ctx} k={k('meta1')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta2')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta3')} as="span" className="text-wa-deep" />
            </div>
          </div>

          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif text-[44px] sm:text-[64px] lg:text-[88px] leading-[0.92] tracking-[-0.02em] mb-12 reveal"
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 reveal" style={vd('120ms')}>
            <div className="col-span-12 lg:col-span-7 hairline rounded-3xl bg-white p-9 relative">
              <svg viewBox="0 0 32 24" className="w-12 h-9 text-wa-deep mb-5" fill="currentColor">
                <path d="M6 0C2.7 0 0 2.7 0 6v6c0 3.3 2.7 6 6 6 1 0 1.5-.5 1.5-1.5S7 15 6 15c-1.7 0-3-1.3-3-3h3c1.7 0 3-1.3 3-3V6c0-3.3-2.7-6-3-6zm20 0c-3.3 0-6 2.7-6 6v6c0 3.3 2.7 6 6 6 1 0 1.5-.5 1.5-1.5S27 15 26 15c-1.7 0-3-1.3-3-3h3c1.7 0 3-1.3 3-3V6c0-3.3-2.7-6-3-6z" />
              </svg>
              <T
                ctx={ctx}
                k={k('feat_quote')}
                as="p"
                className="serif text-[26px] sm:text-[36px] leading-[1.18]"
              />
              <div className="mt-8 flex items-center gap-4 hairline-t pt-5">
                <T
                  ctx={ctx}
                  k={k('feat_initials')}
                  as="span"
                  className="w-14 h-14 rounded-full bg-gradient-to-br from-accent-coral to-accent-amber flex items-center justify-center text-paper-0 font-semibold"
                />
                <div className="flex-1 min-w-0">
                  <T
                    ctx={ctx}
                    k={k('feat_author')}
                    as="div"
                    className="text-[14px] font-semibold"
                  />
                  <T ctx={ctx} k={k('feat_role')} as="div" className="text-[12px] text-ink-500" />
                </div>
                <div className="text-end">
                  <T
                    ctx={ctx}
                    k={k('feat_stat')}
                    as="div"
                    className="serif text-[24px] text-wa-deep"
                  />
                  <T
                    ctx={ctx}
                    k={k('feat_stat_label')}
                    as="div"
                    className="mono text-[10px] text-ink-500"
                  />
                </div>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-5 grid grid-rows-2 gap-5">
              <div className="hairline rounded-3xl bg-white p-6">
                <T
                  ctx={ctx}
                  k={k('quote1_rating')}
                  as="div"
                  className="mono text-[10px] uppercase tracking-widest text-wa-deep mb-2"
                />
                <p className="text-[15px] leading-snug" {...a('quote1_text')}>
                  "{ctx.fc(k('quote1_text'))}"
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <T
                    ctx={ctx}
                    k={k('quote1_initials')}
                    as="span"
                    className="w-10 h-10 rounded-full bg-gradient-to-br from-wa-deep to-wa-teal text-paper-0 text-[12px] font-semibold flex items-center justify-center"
                  />
                  <div>
                    <T
                      ctx={ctx}
                      k={k('quote1_author')}
                      as="div"
                      className="text-[13px] font-semibold"
                    />
                    <T
                      ctx={ctx}
                      k={k('quote1_role')}
                      as="div"
                      className="text-[11px] text-ink-500"
                    />
                  </div>
                </div>
              </div>

              <div className="hairline rounded-3xl bg-ink-950 text-paper-0 p-6 relative overflow-hidden">
                <div className="absolute inset-0 dot-pattern opacity-15"></div>
                <div className="relative">
                  <T
                    ctx={ctx}
                    k={k('quote2_rating')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-widest text-wa-green mb-2"
                  />
                  <p className="text-[15px] leading-snug" {...a('quote2_text')}>
                    "{ctx.fc(k('quote2_text'))}"
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <T
                      ctx={ctx}
                      k={k('quote2_initials')}
                      as="span"
                      className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-amber to-wa-green text-ink-900 text-[12px] font-semibold flex items-center justify-center"
                    />
                    <div>
                      <T
                        ctx={ctx}
                        k={k('quote2_author')}
                        as="div"
                        className="text-[13px] font-semibold"
                      />
                      <T
                        ctx={ctx}
                        k={k('quote2_role')}
                        as="div"
                        className="text-[11px] text-paper-0/60"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-span-12 grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
              {[1, 2, 3, 4]
                .filter((i) => has(ctx, def.slug, `tile${i}_val`))
                .map((i) => (
                  <div key={i} className="hairline rounded-2xl bg-white p-5">
                    <div className="mono text-[10px] uppercase tracking-widest text-ink-500">
                      {<T ctx={ctx} k={k(`tile${i}_label`)} as="span" />}
                    </div>
                    <div className="serif text-[40px] leading-none mt-3">
                      {<T ctx={ctx} k={k(`tile${i}_val`)} as="span" />}
                      <span className="text-[20px] text-ink-500">
                        {<T ctx={ctx} k={k(`tile${i}_suffix`)} as="span" />}
                      </span>
                    </div>
                    <div className="mono text-[10px] text-ink-500 mt-1">
                      {<T ctx={ctx} k={k(`tile${i}_sub`)} as="span" />}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
