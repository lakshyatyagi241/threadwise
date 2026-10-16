import Link from 'next/link';
import type { CmsSection } from '@crm/contracts';
import { T, type SiteCtx } from './site-ui';
import { mk, vd } from './tw-common';

interface P {
  ctx: SiteCtx;
  def: CmsSection;
}

export function AboutHero({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="relative overflow-hidden bg-paper-0">
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none"></div>
        <div className="absolute -top-32 -end-32 w-[520px] h-[520px] rounded-full bg-wa-mint/50 blur-bub"></div>
        <div className="absolute -bottom-40 -start-32 w-[460px] h-[460px] rounded-full bg-accent-amber/15 blur-bub"></div>

        <div className="relative max-w-[1360px] mx-auto px-7 py-28">
          <div className="grid grid-cols-12 gap-8 items-end">
            <div className="col-span-12 lg:col-span-8 reveal">
              <T ctx={ctx} k={k('eyebrow')} as="span" className="badge-num mb-6 inline-block" />
              <T
                ctx={ctx}
                k={k('headline')}
                as="h1"
                className="serif text-[80px] lg:text-[104px] leading-[0.92] tracking-[-0.025em]"
              />
            </div>
            <div className="col-span-12 lg:col-span-4 reveal" style={vd('120ms')}>
              <T
                ctx={ctx}
                k={k('intro')}
                as="p"
                className="text-[15.5px] text-ink-700 leading-relaxed border-s-2 border-wa-deep ps-4"
              />

              <div className="mt-6 grid grid-cols-3 gap-0 hairline-t hairline-b py-4">
                <div className="hairline-r pe-4">
                  <T
                    ctx={ctx}
                    k={k('stat1_value')}
                    as="div"
                    className="serif text-[32px] leading-none tabular text-wa-deep"
                  />
                  <T
                    ctx={ctx}
                    k={k('stat1_label')}
                    as="div"
                    className="mono text-[9px] uppercase tracking-widest text-ink-500 mt-1.5"
                  />
                </div>
                <div className="hairline-r px-4">
                  <T
                    ctx={ctx}
                    k={k('stat2_value')}
                    as="div"
                    className="serif text-[32px] leading-none tabular text-wa-deep"
                  />
                  <T
                    ctx={ctx}
                    k={k('stat2_label')}
                    as="div"
                    className="mono text-[9px] uppercase tracking-widest text-ink-500 mt-1.5"
                  />
                </div>
                <div className="ps-4">
                  <T
                    ctx={ctx}
                    k={k('stat3_value')}
                    as="div"
                    className="serif text-[32px] leading-none tabular text-wa-deep"
                  />
                  <T
                    ctx={ctx}
                    k={k('stat3_label')}
                    as="div"
                    className="mono text-[9px] uppercase tracking-widest text-ink-500 mt-1.5"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export function OriginStory({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-white">
        <div className="max-w-[1360px] mx-auto px-7 py-28">
          <div className="grid grid-cols-12 gap-8 mb-12">
            <div className="col-span-2">
              <div className="feature-num">01</div>
            </div>
            <div className="col-span-3 flex flex-col justify-end pb-3">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('sublabel')} as="div" className="text-[13px] font-semibold" />
            </div>
            <div className="col-span-7 flex items-end justify-end pb-3 gap-3 text-[11px] mono text-ink-500">
              <T ctx={ctx} k={k('location')} as="span" />
              <span className="text-ink-300">·</span>
              <T ctx={ctx} k={k('since')} as="span" />
            </div>
          </div>

          <div className="grid grid-cols-12 gap-12 items-start">
            <div className="col-span-12 lg:col-span-7 reveal">
              <T
                ctx={ctx}
                k={k('para1')}
                as="p"
                className="serif text-[36px] leading-[1.2] tracking-[-0.01em] text-ink-900"
              />
              <T
                ctx={ctx}
                k={k('para2')}
                as="p"
                className="serif text-[36px] leading-[1.2] tracking-[-0.01em] text-ink-900 mt-6"
              />
              <T
                ctx={ctx}
                k={k('para3')}
                as="p"
                className="serif text-[36px] leading-[1.2] tracking-[-0.01em] text-ink-900 mt-6"
              />
            </div>

            <div className="col-span-12 lg:col-span-5 reveal" style={vd('160ms')}>
              <div className="hairline rounded-3xl bg-paper-50 p-8 sticky top-28">
                <T
                  ctx={ctx}
                  k={k('glance_label')}
                  as="div"
                  className="mono text-[10px] uppercase tracking-widest text-ink-500 mb-4"
                />

                <ul className="space-y-4">
                  <li className="hairline-b pb-4 flex items-baseline justify-between">
                    <T
                      ctx={ctx}
                      k={k('glance_r1_label')}
                      as="span"
                      className="text-[13px] text-ink-700"
                    />
                    <T
                      ctx={ctx}
                      k={k('glance_r1_value')}
                      as="span"
                      className="serif text-[20px] text-wa-deep"
                    />
                  </li>
                  <li className="hairline-b pb-4 flex items-baseline justify-between">
                    <T
                      ctx={ctx}
                      k={k('glance_r2_label')}
                      as="span"
                      className="text-[13px] text-ink-700"
                    />
                    <T
                      ctx={ctx}
                      k={k('glance_r2_value')}
                      as="span"
                      className="serif text-[20px] text-wa-deep"
                    />
                  </li>
                  <li className="hairline-b pb-4 flex items-baseline justify-between">
                    <T
                      ctx={ctx}
                      k={k('glance_r3_label')}
                      as="span"
                      className="text-[13px] text-ink-700"
                    />
                    <T
                      ctx={ctx}
                      k={k('glance_r3_value')}
                      as="span"
                      className="serif text-[20px] text-wa-deep"
                    />
                  </li>
                  <li className="hairline-b pb-4 flex items-baseline justify-between">
                    <T
                      ctx={ctx}
                      k={k('glance_r4_label')}
                      as="span"
                      className="text-[13px] text-ink-700"
                    />
                    <T
                      ctx={ctx}
                      k={k('glance_r4_value')}
                      as="span"
                      className="serif text-[20px] text-wa-deep"
                    />
                  </li>
                  <li className="hairline-b pb-4 flex items-baseline justify-between">
                    <T
                      ctx={ctx}
                      k={k('glance_r5_label')}
                      as="span"
                      className="text-[13px] text-ink-700"
                    />
                    <T
                      ctx={ctx}
                      k={k('glance_r5_value')}
                      as="span"
                      className="serif text-[20px] text-wa-deep"
                    />
                  </li>
                  <li className="pb-1 flex items-baseline justify-between">
                    <T
                      ctx={ctx}
                      k={k('glance_r6_label')}
                      as="span"
                      className="text-[13px] text-ink-700"
                    />
                    <T
                      ctx={ctx}
                      k={k('glance_r6_value')}
                      as="span"
                      className="serif text-[20px] text-wa-deep"
                    />
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export function Values({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-paper-50 hairline-t hairline-b">
        <div className="max-w-[1360px] mx-auto px-7 py-28">
          <div className="grid grid-cols-12 gap-8 mb-12">
            <div className="col-span-2">
              <div className="feature-num">02</div>
            </div>
            <div className="col-span-3 flex flex-col justify-end pb-3">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('sublabel')} as="div" className="text-[13px] font-semibold" />
            </div>
            <div className="col-span-7 flex items-end justify-end pb-3 gap-3 text-[11px] mono text-ink-500">
              <T ctx={ctx} k={k('caption')} as="span" className="text-wa-deep" />
            </div>
          </div>

          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif text-[88px] leading-[0.92] tracking-[-0.02em] mb-12 reveal"
          />

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-5 reveal" style={vd('120ms')}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="hairline rounded-3xl bg-white p-6">
                <div className="serif text-[48px] leading-none text-wa-deep/40">
                  {['i', 'ii', 'iii', 'iv', 'v'][i - 1]}
                </div>
                <T
                  ctx={ctx}
                  k={k(`item${i}_title`)}
                  as="h3"
                  className="serif text-[24px] leading-tight mt-4"
                />
                <T
                  ctx={ctx}
                  k={k(`item${i}_desc`)}
                  as="p"
                  className="text-[12.5px] text-ink-600 mt-3 leading-relaxed"
                />
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function Timeline({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-white">
        <div className="max-w-[1360px] mx-auto px-7 py-28">
          <div className="grid grid-cols-12 gap-8 mb-12">
            <div className="col-span-2">
              <div className="feature-num">03</div>
            </div>
            <div className="col-span-3 flex flex-col justify-end pb-3">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('sublabel')} as="div" className="text-[13px] font-semibold" />
            </div>
          </div>

          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif text-[88px] leading-[0.92] tracking-[-0.02em] mb-12 reveal"
          />

          <div
            className="hairline rounded-3xl bg-paper-50 overflow-hidden reveal"
            style={vd('120ms')}
          >
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`grid grid-cols-12 gap-6 px-8 py-7 ${i < 4 ? 'hairline-b' : ''}`}
              >
                <div className="col-span-2">
                  <T
                    ctx={ctx}
                    k={k(`item${i}_qtr`)}
                    as="div"
                    className="mono text-[10px] uppercase tracking-widest text-wa-deep"
                  />
                </div>
                <div className="col-span-1 flex justify-center relative">
                  <span
                    className={`w-3 h-3 rounded-full ${i < 4 ? 'bg-wa-green' : 'bg-paper-300'} mt-2 relative z-10`}
                  ></span>
                  {i < 4 && <div className="absolute top-5 bottom-[-28px] w-px bg-paper-200"></div>}
                </div>
                <div className="col-span-9">
                  <T
                    ctx={ctx}
                    k={k(`item${i}_title`)}
                    as="h3"
                    className="serif text-[28px] leading-tight"
                  />
                  <T
                    ctx={ctx}
                    k={k(`item${i}_desc`)}
                    as="p"
                    className="text-[13.5px] text-ink-700 mt-2 leading-relaxed max-w-2xl"
                  />
                  {i < 4 ? (
                    <span className="pill bg-wa-bubble text-wa-deep text-[10px] mt-3 inline-flex">
                      <span className="w-1.5 h-1.5 rounded-full bg-wa-green"></span>shipped
                    </span>
                  ) : (
                    <span className="pill bg-paper-100 text-ink-700 text-[10px] mt-3 inline-flex">
                      upcoming
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function Numbers({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-paper-50 hairline-t hairline-b">
        <div className="max-w-[1360px] mx-auto px-7 py-28">
          <div className="grid grid-cols-12 gap-8 mb-12">
            <div className="col-span-2">
              <div className="feature-num">04</div>
            </div>
            <div className="col-span-3 flex flex-col justify-end pb-3">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('sublabel')} as="div" className="text-[13px] font-semibold" />
            </div>
            <div className="col-span-7 flex items-end justify-end pb-3 gap-3 text-[11px] mono text-ink-500"></div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 reveal" style={vd('120ms')}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="hairline rounded-2xl bg-white p-6">
                <T
                  ctx={ctx}
                  k={k(`item${i}_big`)}
                  as="div"
                  className="serif text-[56px] leading-none tabular text-wa-deep"
                />
                <T
                  ctx={ctx}
                  k={k(`item${i}_label`)}
                  as="div"
                  className="mono text-[10px] uppercase tracking-widest text-ink-500 mt-3"
                />
                <T
                  ctx={ctx}
                  k={k(`item${i}_sub`)}
                  as="div"
                  className="text-[12px] text-ink-600 mt-1"
                />
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function Press({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-white">
        <div className="max-w-[1360px] mx-auto px-7 py-28">
          <div className="grid grid-cols-12 gap-8 mb-12">
            <div className="col-span-2">
              <div className="feature-num">05</div>
            </div>
            <div className="col-span-3 flex flex-col justify-end pb-3">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('sublabel')} as="div" className="text-[13px] font-semibold" />
            </div>
          </div>

          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif text-[88px] leading-[0.92] tracking-[-0.02em] mb-12 reveal"
          />

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-5 reveal" style={vd('120ms')}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="hairline rounded-2xl bg-paper-50 p-6 hover:border-wa-deep transition"
              >
                <div className="flex items-center justify-between mb-3">
                  <T ctx={ctx} k={k(`item${i}_outlet`)} as="div" className="serif text-[20px]" />
                  <T
                    ctx={ctx}
                    k={k(`item${i}_date`)}
                    as="div"
                    className="mono text-[10px] text-ink-500"
                  />
                </div>
                <T
                  ctx={ctx}
                  k={k(`item${i}_blurb`)}
                  as="p"
                  className="text-[13px] text-ink-700 leading-relaxed"
                />
                <Link href="#" className="text-[12px] text-wa-deep font-semibold mt-4 inline-block">
                  Read article →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function Backers({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-paper-50 hairline-t hairline-b">
        <div className="max-w-[1360px] mx-auto px-7 py-28">
          <div className="grid grid-cols-12 gap-8 mb-12">
            <div className="col-span-2">
              <div className="feature-num">06</div>
            </div>
            <div className="col-span-3 flex flex-col justify-end pb-3">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('sublabel')} as="div" className="text-[13px] font-semibold" />
            </div>
          </div>

          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif text-[88px] leading-[0.92] tracking-[-0.02em] mb-12 reveal"
          />

          <div
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5 reveal"
            style={vd('120ms')}
          >
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="hairline rounded-2xl bg-white p-6 flex items-center justify-center min-h-[100px]"
              >
                <T ctx={ctx} k={k(`vc${i}`)} as="div" className="serif text-[20px] text-center" />
              </div>
            ))}
          </div>

          <div className="mt-10 hairline rounded-3xl bg-white p-8">
            <T
              ctx={ctx}
              k={k('operators_label')}
              as="div"
              className="mono text-[10px] uppercase tracking-widest text-ink-500 mb-4"
            />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-3 text-[13px]">
              {[1, 2, 3, 4].map((i) => (
                <div key={i}>
                  <T ctx={ctx} k={k(`op${i}_name`)} as="div" className="font-semibold" />
                  <T
                    ctx={ctx}
                    k={k(`op${i}_title`)}
                    as="div"
                    className="mono text-[10px] text-ink-500 mt-0.5"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export function ContactHero({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="relative overflow-hidden bg-paper-0">
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none"></div>
        <div className="absolute -top-32 -end-32 w-[520px] h-[520px] rounded-full bg-wa-mint/50 blur-bub"></div>
        <div className="absolute -bottom-40 -start-32 w-[460px] h-[460px] rounded-full bg-accent-amber/15 blur-bub"></div>

        <div className="relative max-w-[1360px] mx-auto px-7 py-28">
          <div className="grid grid-cols-12 gap-8 items-end">
            <div className="col-span-12 lg:col-span-8 reveal">
              <span className="badge-num mb-6 inline-block" {...a('eyebrow')}>
                — {ctx.fc(k('eyebrow'))}
              </span>
              <T
                ctx={ctx}
                k={k('headline')}
                as="h1"
                className="serif text-[80px] lg:text-[104px] leading-[0.92] tracking-[-0.025em]"
              />
            </div>
            <div className="col-span-12 lg:col-span-4 reveal" style={vd('120ms')}>
              <T
                ctx={ctx}
                k={k('intro')}
                as="p"
                className="text-[15.5px] text-ink-700 leading-relaxed border-s-2 border-wa-deep ps-4"
              />

              <div className="mt-6 grid grid-cols-3 gap-0 hairline-t hairline-b py-4">
                <div className="hairline-r pe-4">
                  <T
                    ctx={ctx}
                    k={k('stat1_value')}
                    as="div"
                    className="serif text-[32px] leading-none tabular text-wa-deep"
                  />
                  <T
                    ctx={ctx}
                    k={k('stat1_label')}
                    as="div"
                    className="mono text-[9px] uppercase tracking-widest text-ink-500 mt-1.5"
                  />
                </div>
                <div className="hairline-r px-4">
                  <T
                    ctx={ctx}
                    k={k('stat2_value')}
                    as="div"
                    className="serif text-[32px] leading-none tabular text-wa-deep"
                  />
                  <T
                    ctx={ctx}
                    k={k('stat2_label')}
                    as="div"
                    className="mono text-[9px] uppercase tracking-widest text-ink-500 mt-1.5"
                  />
                </div>
                <div className="ps-4">
                  <T
                    ctx={ctx}
                    k={k('stat3_value')}
                    as="div"
                    className="serif text-[32px] leading-none tabular text-wa-deep"
                  />
                  <T
                    ctx={ctx}
                    k={k('stat3_label')}
                    as="div"
                    className="mono text-[9px] uppercase tracking-widest text-ink-500 mt-1.5"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
