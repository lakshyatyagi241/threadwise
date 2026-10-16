import Link from 'next/link';
import type { CmsSection } from '@crm/contracts';
import { T, type SiteCtx } from './site-ui';
import { mk, vd } from './tw-common';

interface P {
  ctx: SiteCtx;
  def: CmsSection;
}

export function FeatureBroadcasts({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-paper-50 hairline-t hairline-b">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-7 py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12">
            <div className="col-span-12 lg:col-span-2">
              <div className="feature-num text-[88px] sm:text-[120px] lg:text-[140px]">01</div>
            </div>
            <div className="col-span-12 lg:col-span-3 flex flex-col justify-end pb-3">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('label')} as="div" className="text-[13px] font-semibold" />
            </div>
            <div className="col-span-12 lg:col-span-7 flex items-end justify-start lg:justify-end pb-3 gap-3 text-[11px] mono text-ink-500 flex-wrap">
              <T ctx={ctx} k={k('meta1')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta2')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta3')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta4')} as="span" className="text-wa-deep" />
            </div>
          </div>

          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif text-[44px] sm:text-[64px] lg:text-[88px] leading-[0.92] tracking-[-0.02em] mb-3 reveal"
          />
          <T
            ctx={ctx}
            k={k('body')}
            as="p"
            className="text-[15.5px] text-ink-700 max-w-2xl leading-relaxed reveal"
          />

          <div className="mt-14 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="col-span-12 lg:col-span-7 reveal">
              <div className="hairline rounded-3xl bg-white p-6 shadow-[0_24px_60px_-30px_rgba(7,94,84,0.25)]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-coral to-accent-amber flex items-center justify-center text-paper-0 text-[11px] font-bold">
                      SP
                    </span>
                    <div>
                      <div className="text-[14px] font-semibold">Spring Promo · Tier-2 EU</div>
                      <div className="mono text-[10px] text-ink-500">
                        spring_promo_v3 · EN/ES/FR · A/B · 2 variants
                      </div>
                    </div>
                  </div>
                  <span className="pill bg-wa-green/15 text-wa-deep">
                    <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>Sending
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <div className="flex-1 h-2.5 rounded-full bg-paper-100 overflow-hidden flex">
                    <div className="h-full bg-wa-deep" style={{ width: '55%' }}></div>
                    <div className="h-full bg-wa-green" style={{ width: '33%' }}></div>
                  </div>
                  <span className="mono text-[11px] tabular font-semibold">88%</span>
                </div>

                <div className="mb-4 flex flex-wrap gap-1.5">
                  <span className="hairline rounded-md bg-paper-50 px-2 py-1 text-[10.5px] mono">
                    <span className="text-ink-500">tag:</span> vip
                  </span>
                  <span className="hairline rounded-md bg-paper-50 px-2 py-1 text-[10.5px] mono">
                    <span className="text-ink-500">geo:</span> EU
                  </span>
                  <span className="hairline rounded-md bg-paper-50 px-2 py-1 text-[10.5px] mono">
                    <span className="text-ink-500">spend &gt;</span> €120
                  </span>
                  <span className="hairline rounded-md bg-paper-50 px-2 py-1 text-[10.5px] mono">
                    <span className="text-ink-500">last_order &lt;</span> 60d
                  </span>
                  <span className="hairline rounded-md bg-paper-50 px-2 py-1 text-[10.5px] mono">
                    <span className="text-ink-500">opted_in:</span> true
                  </span>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5 text-center">
                  <div className="hairline rounded-xl bg-paper-50 py-3">
                    <div className="mono text-[9px] text-ink-500">SENT</div>
                    <div className="serif text-[24px] mt-0.5">42.1k</div>
                  </div>
                  <div className="hairline rounded-xl bg-paper-50 py-3">
                    <div className="mono text-[9px] text-ink-500">DELIV</div>
                    <div className="serif text-[24px] mt-0.5">98.4%</div>
                  </div>
                  <div className="hairline border-wa-green/40 rounded-xl bg-wa-bubble py-3">
                    <div className="mono text-[9px] text-wa-deep">READ</div>
                    <div className="serif text-[24px] mt-0.5 text-wa-deep">86%</div>
                  </div>
                  <div className="hairline rounded-xl bg-paper-50 py-3">
                    <div className="mono text-[9px] text-ink-500">CTR</div>
                    <div className="serif text-[24px] mt-0.5">11.4%</div>
                  </div>
                  <div className="hairline rounded-xl bg-paper-50 py-3">
                    <div className="mono text-[9px] text-ink-500">REV</div>
                    <div className="serif text-[24px] mt-0.5">$84k</div>
                  </div>
                </div>

                <div className="mt-5 hairline-t pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="hairline rounded-xl bg-paper-50 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11.5px] font-semibold">
                        Variant A · "🌸 Mother's Day"
                      </span>
                      <span className="pill bg-wa-deep text-paper-0 text-[10px]">Winner</span>
                    </div>
                    <div className="text-[10.5px] mono text-ink-500">CTR 13.2% · CVR 4.1%</div>
                    <div className="mt-2 h-1.5 rounded-full bg-paper-100 overflow-hidden">
                      <div className="h-full bg-wa-deep" style={{ width: '78%' }}></div>
                    </div>
                  </div>
                  <div className="hairline rounded-xl bg-white p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11.5px] font-semibold">
                        Variant B · "Mom deserves it"
                      </span>
                      <span className="pill bg-paper-100 text-ink-500 text-[10px]">Lost</span>
                    </div>
                    <div className="text-[10.5px] mono text-ink-500">CTR 9.6% · CVR 2.8%</div>
                    <div className="mt-2 h-1.5 rounded-full bg-paper-100 overflow-hidden">
                      <div className="h-full bg-ink-400" style={{ width: '52%' }}></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="hairline rounded-3xl bg-white p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="mono text-[10px] uppercase tracking-widest text-ink-500">
                      Per-timezone send
                    </div>
                    <span className="pill bg-wa-bubble text-wa-deep text-[10px]">live</span>
                  </div>
                  <div className="serif text-[28px] leading-none mb-3">
                    9<span className="text-ink-400">:</span>00
                    <span className="text-[14px] text-ink-500 ms-1">am · local</span>
                  </div>
                  <ul className="space-y-2 text-[11.5px]">
                    <li className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-wa-deep"></span>Madrid · ES
                      </span>
                      <span className="mono text-ink-500">09:00 · sent 12.4k</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-wa-green"></span>Berlin · DE
                      </span>
                      <span className="mono text-ink-500">09:00 · sent 8.9k</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-amber"></span>Lisbon ·
                        PT
                      </span>
                      <span className="mono text-ink-500">09:00 · queued</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-ink-400"></span>Athens · GR
                      </span>
                      <span className="mono text-ink-500">+2h · queued</span>
                    </li>
                  </ul>
                  <div className="hairline-t mt-4 pt-3 text-[11px] text-ink-600">
                    Quiet-hours respected per market.
                  </div>
                </div>

                <div className="hairline rounded-3xl bg-white p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="mono text-[10px] uppercase tracking-widest text-ink-500">
                      Sender rating · 7d
                    </div>
                    <span className="pill bg-wa-green/15 text-wa-deep text-[10px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>
                      healthy
                    </span>
                  </div>
                  <div className="serif text-[28px] leading-none mb-3">
                    High <span className="text-[14px] text-ink-500 ms-1">· no throttle</span>
                  </div>
                  <div className="flex items-end gap-1.5 h-16 mb-3">
                    <div
                      className="flex-1 bg-wa-deep/30 rounded-sm"
                      style={{ height: '62%' }}
                    ></div>
                    <div
                      className="flex-1 bg-wa-deep/40 rounded-sm"
                      style={{ height: '70%' }}
                    ></div>
                    <div
                      className="flex-1 bg-wa-deep/50 rounded-sm"
                      style={{ height: '55%' }}
                    ></div>
                    <div
                      className="flex-1 bg-wa-deep/60 rounded-sm"
                      style={{ height: '78%' }}
                    ></div>
                    <div
                      className="flex-1 bg-wa-deep/70 rounded-sm"
                      style={{ height: '84%' }}
                    ></div>
                    <div
                      className="flex-1 bg-wa-deep/80 rounded-sm"
                      style={{ height: '92%' }}
                    ></div>
                    <div className="flex-1 bg-wa-deep rounded-sm" style={{ height: '96%' }}></div>
                  </div>
                  <ul className="space-y-1.5 text-[11.5px]">
                    <li className="flex items-center justify-between">
                      <span className="text-ink-700">Block rate</span>
                      <span className="mono text-wa-deep">0.04%</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="text-ink-700">Read rate</span>
                      <span className="mono text-wa-deep">86.2%</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="text-ink-700">Auto-pause</span>
                      <span className="mono text-ink-500">armed</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-5 reveal" style={vd('200ms')}>
              <div className="space-y-0 hairline rounded-3xl bg-white overflow-hidden">
                <T
                  ctx={ctx}
                  k={k('rail_title')}
                  as="div"
                  className="px-6 py-4 hairline-b mono text-[10.5px] uppercase tracking-widest text-ink-500 bg-paper-50"
                />
                <ul className="divide-y divide-paper-200">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <li key={i} className="px-6 py-4 grid grid-cols-[28px_1fr] gap-3 items-start">
                      <span className="serif text-[20px] text-wa-deep leading-none mt-0.5">
                        {String(i).padStart(2, '0')}
                      </span>
                      <div>
                        <div className="text-[14px] font-semibold mb-1">
                          {<T ctx={ctx} k={k(`rail${i}_title`)} as="span" />}
                        </div>
                        <p className="text-[12.5px] text-ink-600 leading-relaxed">
                          {<T ctx={ctx} k={k(`rail${i}_desc`)} as="span" />}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="px-6 py-4 bg-paper-50 flex items-center justify-between">
                  <T
                    ctx={ctx}
                    k={k('footer_note')}
                    as="span"
                    className="text-[12px] text-ink-700"
                  />
                  <Link
                    href={ctx.fc(k('cta_url')) || '#'}
                    {...u('cta_url')}
                    className="text-[12.5px] text-wa-deep font-semibold"
                  >
                    <T ctx={ctx} k={k('cta_label')} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export function FeatureFlows({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-white">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-7 py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12">
            <div className="lg:col-span-2">
              <div className="feature-num text-[80px] sm:text-[110px] lg:text-[140px]">02</div>
            </div>
            <div className="lg:col-span-3 flex flex-col justify-end pb-3">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('label')} as="div" className="text-[13px] font-semibold" />
            </div>
            <div className="lg:col-span-7 flex flex-wrap items-end lg:justify-end pb-3 gap-3 text-[11px] mono text-ink-500">
              <T ctx={ctx} k={k('meta1')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta2')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta3')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta4')} as="span" className="text-wa-deep" />
            </div>
          </div>

          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif text-[44px] sm:text-[64px] lg:text-[88px] leading-[0.92] tracking-[-0.02em] mb-3 reveal"
          />
          <T
            ctx={ctx}
            k={k('body')}
            as="p"
            className="text-[15.5px] text-ink-700 max-w-2xl leading-relaxed reveal"
          />

          <div className="mt-14 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div className="col-span-12 lg:col-span-4 reveal">
              <div className="hairline rounded-3xl bg-paper-50 p-6 h-full flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-8 h-8 rounded-lg bg-wa-deep text-paper-0 flex items-center justify-center text-[10px] font-bold">
                    AI
                  </span>
                  <div>
                    <div className="text-[12.5px] font-semibold">Copilot · flow generation</div>
                    <div className="mono text-[9.5px] text-ink-500">GPT-4o · Claude 3.5</div>
                  </div>
                  <span className="ms-auto pill bg-wa-bubble text-wa-deep mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>ready
                  </span>
                </div>
                <div className="hairline rounded-xl bg-white p-3 text-[12.5px] leading-relaxed text-ink-800 flex-1">
                  <span className="mono text-[9px] uppercase tracking-widest text-ink-500 block mb-2">
                    prompt
                  </span>{' '}
                  &ldquo;After a customer abandons cart, wait 1 hour, send the cart back with a 5%
                  off coupon, then follow up at 24h if they haven&apos;t bought.&rdquo;
                </div>
                <div className="mt-3 flex items-center justify-center gap-2 mono text-[10px] text-wa-deep">
                  <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>
                  <span>generated in 2.4s</span>
                </div>
                <div className="mt-3 hairline border-wa-green/40 rounded-xl bg-wa-bubble p-3 text-[12px] leading-relaxed">
                  <span className="text-wa-deep font-semibold">✓ 9 nodes</span> · cart_abandoned
                  trigger · delay 1h · template <span className="mono text-wa-deep">cart_back</span>{' '}
                  · condition <span className="mono text-wa-deep">paid?</span> · delay 23h ·
                  template
                  <span className="mono text-wa-deep">last_call</span> · …
                </div>
                <Link
                  href={ctx.fc(k('cta_url')) || '#'}
                  {...u('cta_url')}
                  className="mt-4 w-full bg-wa-green text-ink-900 rounded-full text-[12.5px] font-semibold py-2.5 text-center hover:bg-[#1ec05a]"
                >
                  <T ctx={ctx} k={k('cta_label')} />
                </Link>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-8 reveal" style={vd('120ms')}>
              <div className="hairline rounded-3xl bg-white p-6 h-full">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-wa-green pulse-dot"></span>
                    <span className="text-[12px] font-semibold">cart_recover_v3.flow</span>
                    <span className="mono text-[10px] text-ink-500">· auto-saved 4s ago</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="pill bg-paper-100 text-ink-700 mono">14 nodes</span>
                    <span className="pill bg-paper-100 text-ink-700 mono">3 branches</span>
                    <span className="pill bg-wa-bubble text-wa-deep mono">v3 · live</span>
                  </div>
                </div>

                <div className="hairline rounded-2xl bg-paper-50 grid-bg p-5 relative h-[360px] overflow-hidden">
                  <div className="absolute top-6 start-6 hairline rounded-xl bg-white shadow-sm p-3 w-[180px]">
                    <div className="mono text-[9px] uppercase tracking-widest text-accent-coral">
                      trigger
                    </div>
                    <div className="text-[12px] font-semibold mt-1">Cart abandoned</div>
                    <div className="text-[10px] text-ink-500 mono mt-0.5">shopify</div>
                  </div>

                  <svg
                    className="absolute top-[60px] start-[170px] w-[140px] h-[60px]"
                    viewBox="0 0 140 60"
                    fill="none"
                  >
                    <path
                      d="M0 5 Q 70 5, 70 30 T 140 50"
                      stroke="#3A5A55"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    <path
                      d="M134 47 L141 50 L134 53"
                      stroke="#3A5A55"
                      strokeWidth="1.5"
                      fill="none"
                    />
                  </svg>

                  <div className="absolute top-[100px] start-[260px] hairline rounded-xl bg-white shadow-sm p-3 w-[150px]">
                    <div className="mono text-[9px] uppercase tracking-widest text-accent-amber">
                      delay
                    </div>
                    <div className="text-[12px] font-semibold mt-1">Wait 1 hour</div>
                    <div className="text-[10px] text-ink-500 mono mt-0.5">3,600 sec</div>
                  </div>

                  <svg
                    className="absolute top-[140px] start-[400px] w-[140px] h-[60px]"
                    viewBox="0 0 140 60"
                    fill="none"
                  >
                    <path
                      d="M0 5 Q 70 5, 70 30 T 140 50"
                      stroke="#3A5A55"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    <path
                      d="M134 47 L141 50 L134 53"
                      stroke="#3A5A55"
                      strokeWidth="1.5"
                      fill="none"
                    />
                  </svg>

                  <div className="absolute top-[180px] start-[490px] hairline rounded-xl bg-white shadow-sm p-3 w-[200px]">
                    <div className="mono text-[9px] uppercase tracking-widest text-wa-deep">
                      message · template
                    </div>
                    <div className="text-[12px] font-semibold mt-1">Send "cart_back"</div>
                    <div className="text-[10px] text-ink-500 mono mt-0.5">+ 5% coupon</div>
                  </div>

                  <svg
                    className="absolute top-[200px] start-[700px] w-[120px] h-[120px]"
                    viewBox="0 0 120 120"
                    fill="none"
                  >
                    <path
                      d="M0 20 Q 60 20, 60 70 T 110 110"
                      stroke="#3A5A55"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    <path
                      d="M0 20 Q 60 20, 60 -10 T 110 -20"
                      stroke="#3A5A55"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                  </svg>

                  <div className="absolute top-[130px] end-6 hairline border-wa-green/40 rounded-xl bg-wa-bubble shadow-sm p-3 w-[180px]">
                    <div className="mono text-[9px] uppercase tracking-widest text-wa-deep">
                      if paid · exit
                    </div>
                    <div className="text-[12px] font-semibold mt-1">Send "thank_you"</div>
                    <div className="text-[10px] text-ink-500 mono mt-0.5">tag: converted</div>
                  </div>

                  <div className="absolute bottom-6 end-6 hairline rounded-xl bg-white shadow-sm p-3 w-[180px]">
                    <div className="mono text-[9px] uppercase tracking-widest text-accent-coral">
                      if no purchase · 23h
                    </div>
                    <div className="text-[12px] font-semibold mt-1">"last_call"</div>
                    <div className="text-[10px] text-ink-500 mono mt-0.5">+ 10% coupon</div>
                  </div>

                  <div className="absolute bottom-3 start-3 hairline rounded-md bg-white px-2 py-1 mono text-[9px] text-ink-500">
                    <span className="text-accent-coral">●</span> trigger ·{' '}
                    <span className="text-accent-amber">●</span> delay ·{' '}
                    <span className="text-wa-deep">●</span> message ·{' '}
                    <span className="text-wa-green">●</span> action
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-4 reveal" style={vd('200ms')}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="hairline rounded-2xl bg-white p-5">
                <div className="serif text-[40px] leading-none text-wa-deep">
                  {['01', '02', '03', '04'][i - 1]}
                </div>
                <div className="mono text-[10px] uppercase tracking-widest text-ink-500 mt-2">
                  {<T ctx={ctx} k={k(`tile${i}_label`)} as="span" />}
                </div>
                <p className="text-[12px] text-ink-600 mt-2">
                  {<T ctx={ctx} k={k(`tile${i}_desc`)} as="span" />}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function FeatureInbox({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-paper-50 hairline-t hairline-b">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-7 py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12">
            <div className="lg:col-span-2">
              <div className="feature-num text-[80px] sm:text-[110px] lg:text-[140px]">03</div>
            </div>
            <div className="lg:col-span-3 flex flex-col justify-end pb-3">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('label')} as="div" className="text-[13px] font-semibold" />
            </div>
            <div className="lg:col-span-7 flex flex-wrap items-end lg:justify-end pb-3 gap-3 text-[11px] mono text-ink-500">
              <T ctx={ctx} k={k('meta1')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta2')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta3')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta4')} as="span" className="text-wa-deep" />
            </div>
          </div>

          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif text-[44px] sm:text-[64px] lg:text-[88px] leading-[0.92] tracking-[-0.02em] mb-3 reveal"
          />
          <T
            ctx={ctx}
            k={k('body')}
            as="p"
            className="text-[15.5px] text-ink-700 max-w-2xl leading-relaxed reveal"
          />

          <div
            className="mt-14 hairline rounded-3xl bg-white overflow-x-auto lg:overflow-hidden reveal"
            style={vd('160ms')}
          >
            <div className="grid grid-cols-12 min-w-[900px] lg:min-w-0 min-h-[520px]">
              <div className="col-span-2 hairline-r p-4 bg-paper-50">
                <div className="mono text-[10px] uppercase tracking-widest text-ink-500 mb-3">
                  Views
                </div>
                <div className="space-y-1 text-[12.5px]">
                  <div className="px-2.5 py-1.5 rounded-lg bg-wa-deep text-paper-0 font-semibold flex items-center justify-between">
                    All open{' '}
                    <span className="mono text-[10px] bg-paper-0/15 px-1.5 rounded">14</span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg flex items-center justify-between text-ink-700">
                    Mine <span className="mono text-[10px] text-ink-500">3</span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg flex items-center justify-between text-ink-700">
                    Unassigned <span className="mono text-[10px] text-accent-coral">5</span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg flex items-center justify-between text-ink-700">
                    SLA breach <span className="mono text-[10px] text-accent-coral">2</span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg flex items-center justify-between text-ink-700">
                    Snoozed <span className="mono text-[10px] text-ink-500">8</span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg flex items-center justify-between text-ink-700">
                    Closed today <span className="mono text-[10px] text-ink-500">42</span>
                  </div>
                </div>
                <div className="mono text-[10px] uppercase tracking-widest text-ink-500 mt-6 mb-3">
                  Tags
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="pill bg-paper-100 text-ink-700">vip</span>
                  <span className="pill bg-accent-coral/15 text-accent-coral">refund</span>
                  <span className="pill bg-accent-amber/20 text-[#8B5A14]">delivery</span>
                  <span className="pill bg-wa-bubble text-wa-deep">loyal</span>
                </div>
              </div>

              <div className="col-span-3 hairline-r">
                <div className="px-4 py-3 hairline-b bg-paper-50 flex items-center justify-between">
                  <span className="text-[12px] font-semibold">All open · 14</span>
                  <span className="mono text-[10px] text-ink-500">SLA: 2m</span>
                </div>
                <div className="divide-y divide-paper-200">
                  <div className="px-4 py-3 bg-wa-bubble/30 cursor-pointer">
                    <div className="flex items-center justify-between text-[12.5px] font-medium">
                      Maya R.<span className="mono text-[10px] text-wa-deep">2m</span>
                    </div>
                    <div className="text-[11px] text-ink-500 truncate mt-0.5">
                      my order #4218 says delivered…
                    </div>
                    <div className="flex items-center gap-1 mt-1.5">
                      <span className="pill bg-paper-50 text-ink-700 text-[9.5px]">vip</span>
                      <span className="pill bg-accent-coral/15 text-accent-coral text-[9.5px]">
                        delivery
                      </span>
                    </div>
                  </div>
                  <div className="px-4 py-3 cursor-pointer">
                    <div className="flex items-center justify-between text-[12.5px] font-medium">
                      Anish K.
                      <span className="mono text-[10px] text-accent-coral">8m · breach</span>
                    </div>
                    <div className="text-[11px] text-ink-500 truncate mt-0.5">
                      extend my Pro plan?
                    </div>
                  </div>
                  <div className="px-4 py-3 cursor-pointer">
                    <div className="flex items-center justify-between text-[12.5px] font-medium">
                      Tomás S.<span className="mono text-[10px] text-ink-500">14m</span>
                    </div>
                    <div className="text-[11px] text-ink-500 truncate mt-0.5">
                      📎 receipt.pdf · refund
                    </div>
                  </div>
                  <div className="px-4 py-3 cursor-pointer">
                    <div className="flex items-center justify-between text-[12.5px] font-medium">
                      Sara K.<span className="mono text-[10px] text-ink-500">22m</span>
                    </div>
                    <div className="text-[11px] text-ink-500 truncate mt-0.5">
                      do you ship to Berlin?
                    </div>
                  </div>
                  <div className="px-4 py-3 cursor-pointer">
                    <div className="flex items-center justify-between text-[12.5px] font-medium">
                      Lina O.<span className="mono text-[10px] text-ink-500">38m</span>
                    </div>
                    <div className="text-[11px] text-ink-500 truncate mt-0.5">
                      missing 1 stem 🌷
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-span-5 hairline-r chat-grid p-4 relative">
                <div className="bg-white hairline rounded-lg px-3 py-2 mb-4 flex items-center gap-3">
                  <span className="w-9 h-9 rounded-full bg-gradient-to-br from-accent-coral to-accent-amber flex items-center justify-center text-paper-0 text-[11px] font-semibold">
                    MR
                  </span>
                  <div className="flex-1">
                    <div className="text-[12.5px] font-semibold">Maya Ramaswamy</div>
                    <div className="mono text-[10px] text-ink-500">
                      +91 98xx · VIP · 12 orders · LTV $1,840
                    </div>
                  </div>
                  <span className="pill bg-wa-bubble text-wa-deep">
                    <span className="w-1.5 h-1.5 rounded-full bg-wa-green"></span>online
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex">
                    <div className="bg-white rounded-lg rounded-ss-sm px-3 py-2 max-w-[78%] shadow-sm">
                      <div className="text-[11.5px]">
                        order #4218 says delivered but I haven't received it 😕
                      </div>
                      <div className="text-[9px] text-ink-500 mono text-end mt-0.5">14:08</div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-wa-bubble rounded-lg rounded-se-sm px-3 py-2 max-w-[78%] shadow-sm">
                      <div className="text-[10px] mono text-wa-deep mb-0.5 font-semibold uppercase tracking-wider">
                        ↳ flow · order_lookup
                      </div>
                      <div className="text-[11.5px]">Checking #4218 with our courier…</div>
                      <div className="text-[9px] text-wa-deep/60 mono text-end mt-0.5">
                        14:08 ✓✓
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-wa-bubble rounded-lg rounded-se-sm px-3 py-2 max-w-[78%] shadow-sm">
                      <div className="text-[11.5px]">
                        Left at apt 4B per courier note. Want me to ping them?
                      </div>
                      <div className="text-[9px] text-wa-deep/60 mono text-end mt-0.5">
                        14:09 ✓✓
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <div className="hairline border-accent-amber/30 bg-accent-amber/10 rounded-lg px-3 py-2 max-w-[88%]">
                      <div className="mono text-[9.5px] uppercase tracking-widest text-[#8B5A14] mb-0.5">
                        internal note · @sara
                      </div>
                      <div className="text-[11.5px] text-ink-800">
                        VIP – let&apos;s offer a 10% credit just in case.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="absolute bottom-4 start-4 end-4 bg-white hairline rounded-xl p-2 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-md hairline flex items-center justify-center text-ink-500">
                    +
                  </span>
                  <div className="flex-1 text-[11.5px] text-ink-400">
                    Reply to Maya · / for canned
                  </div>
                  <span className="pill bg-wa-bubble text-wa-deep">⌘↵</span>
                </div>
              </div>

              <div className="col-span-2 p-4">
                <div className="mono text-[10px] uppercase tracking-widest text-ink-500 mb-3">
                  Customer
                </div>
                <div className="space-y-2.5 text-[11.5px]">
                  <div className="flex justify-between">
                    <span className="text-ink-500">Status</span>
                    <span className="font-semibold text-wa-deep">VIP</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-500">Orders</span>
                    <span className="font-semibold tabular">12</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-500">LTV</span>
                    <span className="font-semibold tabular">$1,840</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-500">First seen</span>
                    <span className="font-semibold">Apr 2024</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-500">Sentiment</span>
                    <span className="font-semibold text-accent-coral">↓ falling</span>
                  </div>
                </div>
                <div className="hairline-t mt-4 pt-4 mono text-[10px] uppercase tracking-widest text-ink-500 mb-3">
                  SLA
                </div>
                <div className="hairline rounded-lg bg-wa-bubble/40 border-wa-green/30 p-2.5">
                  <div className="flex items-center justify-between text-[10.5px] mono">
                    <span className="text-wa-deep">first response</span>
                    <span className="font-semibold">42s</span>
                  </div>
                  <div className="flex items-center justify-between text-[10.5px] mono mt-1">
                    <span className="text-wa-deep">resolution</span>
                    <span className="font-semibold">2m 14s</span>
                  </div>
                </div>
                <div className="hairline-t mt-4 pt-4 mono text-[10px] uppercase tracking-widest text-ink-500 mb-3">
                  Assigned
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-wa-teal to-wa-deep text-paper-0 text-[10px] font-semibold flex items-center justify-center">
                    SK
                  </span>
                  <span className="text-[11.5px]">Sara K.</span>
                </div>
              </div>
            </div>
          </div>

          <div
            className="mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 reveal"
            style={vd('240ms')}
          >
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="hairline rounded-2xl bg-white p-4">
                <div className="serif text-[64px] leading-[0.85] tracking-[-0.04em] text-wa-deep/40">
                  {String(i).padStart(2, '0')}
                </div>
                <div className="text-[13px] font-semibold mt-2">
                  {<T ctx={ctx} k={k(`tile${i}_title`)} as="span" />}
                </div>
                <p className="text-[11.5px] text-ink-600 mt-1">
                  {<T ctx={ctx} k={k(`tile${i}_desc`)} as="span" />}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function FeatureTemplates({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-white">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-7 py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12">
            <div className="lg:col-span-2">
              <div className="feature-num text-[80px] sm:text-[110px] lg:text-[140px]">04</div>
            </div>
            <div className="lg:col-span-3 flex flex-col justify-end pb-3">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('label')} as="div" className="text-[13px] font-semibold" />
            </div>
            <div className="lg:col-span-7 flex flex-wrap items-end lg:justify-end pb-3 gap-3 text-[11px] mono text-ink-500">
              <T ctx={ctx} k={k('meta1')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta2')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta3')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta4')} as="span" className="text-wa-deep" />
            </div>
          </div>

          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif text-[44px] sm:text-[64px] lg:text-[88px] leading-[0.92] tracking-[-0.02em] mb-3 reveal"
          />
          <T
            ctx={ctx}
            k={k('body')}
            as="p"
            className="text-[15.5px] text-ink-700 max-w-2xl leading-relaxed reveal"
          />

          <div className="mt-14 grid grid-cols-1 lg:grid-cols-12 gap-5 reveal" style={vd('160ms')}>
            <div className="col-span-12 lg:col-span-4 hairline rounded-3xl bg-paper-50 p-5 relative">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="w-9 h-9 rounded-lg bg-wa-bubble text-wa-deep flex items-center justify-center mono text-[10px] font-bold">
                    UTL
                  </span>
                  <div>
                    <div className="text-[12.5px] font-semibold">order_paid_v2</div>
                    <div className="mono text-[9.5px] text-ink-500">utility · 8 langs</div>
                  </div>
                </div>
                <span className="pill bg-wa-green/15 text-wa-deep">approved</span>
              </div>
              <div className="chat-grid rounded-xl p-3">
                <div className="bg-white rounded-lg rounded-ss-sm px-3 py-2 max-w-full shadow-sm">
                  <div className="text-[11.5px]">
                    <b>Hi Maya 👋</b>
                    <br />
                    Your order <b>#4218</b>
                    for ₹1,499 has been paid. Tracking link below.
                  </div>
                  <button className="mt-2 w-full hairline border-wa-deep/30 text-wa-deep text-[10px] font-semibold rounded py-1 bg-white">
                    Track order
                  </button>
                  <div className="text-[9px] text-ink-500 mono text-end mt-1">14:08 ✓✓</div>
                </div>
              </div>
              <div className="hairline-t mt-4 pt-3 flex items-center justify-between text-[11px]">
                <span className="mono text-ink-500">31,890 sent</span>
                <span className="text-wa-deep font-semibold">CTR 19.2%</span>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-4 hairline rounded-3xl bg-paper-50 p-5 relative">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="w-9 h-9 rounded-lg bg-accent-coral/20 text-accent-coral flex items-center justify-center mono text-[10px] font-bold">
                    CRSL
                  </span>
                  <div>
                    <div className="text-[12.5px] font-semibold">spring_promo_v3</div>
                    <div className="mono text-[9.5px] text-ink-500">marketing · 3 langs</div>
                  </div>
                </div>
                <span className="pill bg-wa-green/15 text-wa-deep">approved</span>
              </div>
              <div className="chat-grid rounded-xl p-3">
                <div className="bg-white rounded-lg rounded-ss-sm overflow-hidden shadow-sm">
                  <div className="flex gap-1 p-1">
                    <div className="w-14 h-12 rounded bg-gradient-to-br from-accent-coral via-accent-amber to-wa-green shrink-0"></div>
                    <div className="w-14 h-12 rounded bg-gradient-to-br from-wa-teal via-accent-sand to-wa-deep shrink-0"></div>
                    <div className="w-14 h-12 rounded bg-gradient-to-br from-wa-mint via-wa-green to-wa-teal shrink-0"></div>
                  </div>
                  <div className="px-2.5 pb-1.5">
                    <div className="text-[10.5px] font-semibold">Spring picks 🌷</div>
                    <div className="text-[9.5px] text-ink-500">Tap to see prices</div>
                  </div>
                  <div className="hairline-t flex">
                    <button className="flex-1 py-1 text-[10px] text-wa-deep font-semibold">
                      Browse
                    </button>
                    <button className="flex-1 py-1 text-[10px] text-wa-deep font-semibold hairline-l">
                      Chat
                    </button>
                  </div>
                </div>
              </div>
              <div className="hairline-t mt-4 pt-3 flex items-center justify-between text-[11px]">
                <span className="mono text-ink-500">48,201 sent</span>
                <span className="text-wa-deep font-semibold">CTR 11.4%</span>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-4 hairline rounded-3xl bg-paper-50 p-5 relative">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="w-9 h-9 rounded-lg bg-accent-amber/20 text-accent-amber flex items-center justify-center mono text-[10px] font-bold">
                    OTP
                  </span>
                  <div>
                    <div className="text-[12.5px] font-semibold">login_otp_secure</div>
                    <div className="mono text-[9.5px] text-ink-500">authentication · 1 lang</div>
                  </div>
                </div>
                <span className="pill bg-wa-green/15 text-wa-deep">approved</span>
              </div>
              <div className="chat-grid rounded-xl p-3">
                <div className="bg-white rounded-lg rounded-ss-sm px-3 py-2 shadow-sm">
                  <div className="text-[11.5px]">Your one-time code:</div>
                  <div className="text-center my-2">
                    <span className="mono text-[26px] tracking-[0.4em] text-wa-deep font-bold">
                      4 8 2 1
                    </span>
                  </div>
                  <div className="text-[10px] text-ink-500">Valid for 5 minutes</div>
                  <button className="mt-2 w-full hairline border-wa-deep/30 text-wa-deep text-[10px] font-semibold rounded py-1 bg-white">
                    Copy code
                  </button>
                  <div className="text-[9px] text-ink-500 mono text-end mt-1">14:08 ✓✓</div>
                </div>
              </div>
              <div className="hairline-t mt-4 pt-3 flex items-center justify-between text-[11px]">
                <span className="mono text-ink-500">28,402 sent</span>
                <span className="text-wa-deep font-semibold">99.7% deliv</span>
              </div>
            </div>
          </div>

          <div className="mt-14 grid grid-cols-1 lg:grid-cols-12 gap-8 reveal" style={vd('240ms')}>
            <div className="col-span-12 lg:col-span-4">
              <T
                ctx={ctx}
                k={k('how_title')}
                as="h3"
                className="serif text-[36px] leading-[1.05]"
              />
              <T
                ctx={ctx}
                k={k('how_body')}
                as="p"
                className="text-[13px] text-ink-600 mt-3 leading-relaxed"
              />

              <div className="mt-6 hairline rounded-2xl bg-white p-5">
                <div className="flex items-center justify-between mb-3">
                  <T
                    ctx={ctx}
                    k={k('preflight_title')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-widest text-ink-500"
                  />
                  <T
                    ctx={ctx}
                    k={k('preflight_badge')}
                    as="span"
                    className="pill bg-wa-green/15 text-wa-deep text-[10px]"
                  />
                </div>
                <ul className="space-y-2 text-[12px]">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="text-wa-deep mono text-[12px]">✓</span>
                      <span>{<T ctx={ctx} k={k(`rule${i}`)} as="span" />}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="col-span-12 lg:col-span-8">
              <ol className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <li key={i} className="hairline rounded-2xl bg-white p-4 flex items-start gap-4">
                    <span className="serif text-[34px] text-wa-deep leading-none">
                      {'ABCD'[i - 1]}
                    </span>
                    <div>
                      <div className="text-[14px] font-semibold mb-1">
                        {<T ctx={ctx} k={k(`step${i}_title`)} as="span" />}
                      </div>
                      <p className="text-[12.5px] text-ink-600 leading-relaxed">
                        {<T ctx={ctx} k={k(`step${i}_desc`)} as="span" />}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export function FeatureConnectivity({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-paper-50 hairline-t hairline-b">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-7 py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12">
            <div className="lg:col-span-2">
              <div className="feature-num text-[80px] sm:text-[110px] lg:text-[140px]">05</div>
            </div>
            <div className="lg:col-span-3 flex flex-col justify-end pb-3">
              <T
                ctx={ctx}
                k={k('eyebrow')}
                as="div"
                className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mb-1"
              />
              <T ctx={ctx} k={k('label')} as="div" className="text-[13px] font-semibold" />
            </div>
            <div className="lg:col-span-7 flex flex-wrap items-end lg:justify-end pb-3 gap-3 text-[11px] mono text-ink-500">
              <T ctx={ctx} k={k('meta1')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta2')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta3')} as="span" />
              <span className="text-ink-400">·</span>
              <T ctx={ctx} k={k('meta4')} as="span" className="text-wa-deep" />
            </div>
          </div>

          <T
            ctx={ctx}
            k={k('headline')}
            as="h2"
            className="serif text-[44px] sm:text-[64px] lg:text-[88px] leading-[0.92] tracking-[-0.02em] mb-3 reveal"
          />
          <T
            ctx={ctx}
            k={k('body')}
            as="p"
            className="text-[15.5px] text-ink-700 max-w-2xl leading-relaxed reveal"
          />

          <div className="mt-7 flex flex-wrap gap-2 reveal" style={vd('140ms')}>
            {['WhatsApp', 'Instagram', 'Facebook', 'Telegram', 'TikTok', 'SMS'].map((ch) => (
              <span key={ch} className="pill bg-white hairline text-ink-700 text-[12px]">
                {ch}
              </span>
            ))}
          </div>

          <div className="mt-14 grid grid-cols-1 lg:grid-cols-3 gap-5 reveal" style={vd('160ms')}>
            <div className="hairline rounded-3xl bg-white p-7 relative overflow-hidden hover:border-wa-deep transition">
              <div className="absolute top-5 end-5">
                <T
                  ctx={ctx}
                  k={k('card1_badge')}
                  as="span"
                  className="pill bg-wa-bubble text-wa-deep border border-wa-green/40"
                />
              </div>
              <span className="w-14 h-14 rounded-2xl bg-wa-deep text-paper-0 flex items-center justify-center font-bold text-[18px]">
                WA
              </span>
              <div className="mt-5">
                <T
                  ctx={ctx}
                  k={k('card1_channel')}
                  as="div"
                  className="mono text-[10px] uppercase tracking-widest text-ink-500"
                />
                <T
                  ctx={ctx}
                  k={k('card1_name')}
                  as="div"
                  className="serif text-[36px] leading-none mt-1"
                />
              </div>
              <T
                ctx={ctx}
                k={k('card1_headline')}
                as="h3"
                className="text-[15px] font-semibold mt-4"
              />
              <T
                ctx={ctx}
                k={k('card1_desc')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />
              <ul className="mt-5 space-y-1.5 hairline-t pt-4">
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card1_spec1_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card1_spec1_value')}
                    as="span"
                    className="mono text-[10.5px] text-wa-deep font-semibold"
                  />
                </li>
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card1_spec2_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card1_spec2_value')}
                    as="span"
                    className="mono text-[10.5px] text-wa-deep font-semibold"
                  />
                </li>
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card1_spec3_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card1_spec3_value')}
                    as="span"
                    className="mono text-[10.5px] text-wa-deep font-semibold"
                  />
                </li>
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card1_spec4_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card1_spec4_value')}
                    as="span"
                    className="mono text-[10.5px] text-ink-500"
                  />
                </li>
              </ul>
            </div>

            <div className="hairline rounded-3xl bg-white p-7 relative overflow-hidden hover:border-wa-deep transition">
              <span className="w-14 h-14 rounded-2xl bg-[#F22F46] text-paper-0 flex items-center justify-center font-bold text-[18px]">
                Tw
              </span>
              <div className="mt-5">
                <T
                  ctx={ctx}
                  k={k('card2_channel')}
                  as="div"
                  className="mono text-[10px] uppercase tracking-widest text-ink-500"
                />
                <T
                  ctx={ctx}
                  k={k('card2_name')}
                  as="div"
                  className="serif text-[36px] leading-none mt-1"
                />
              </div>
              <T
                ctx={ctx}
                k={k('card2_headline')}
                as="h3"
                className="text-[15px] font-semibold mt-4"
              />
              <T
                ctx={ctx}
                k={k('card2_desc')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />
              <ul className="mt-5 space-y-1.5 hairline-t pt-4">
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card2_spec1_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card2_spec1_value')}
                    as="span"
                    className="mono text-[10.5px] text-wa-deep font-semibold"
                  />
                </li>
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card2_spec2_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card2_spec2_value')}
                    as="span"
                    className="mono text-[10.5px] text-wa-deep font-semibold"
                  />
                </li>
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card2_spec3_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card2_spec3_value')}
                    as="span"
                    className="mono text-[10.5px] text-wa-deep font-semibold"
                  />
                </li>
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card2_spec4_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card2_spec4_value')}
                    as="span"
                    className="mono text-[10.5px] text-ink-500"
                  />
                </li>
              </ul>
            </div>

            <div className="hairline rounded-3xl bg-white p-7 relative overflow-hidden hover:border-wa-deep transition">
              <div className="absolute top-5 end-5">
                <T
                  ctx={ctx}
                  k={k('card3_badge')}
                  as="span"
                  className="pill bg-paper-50 text-ink-700 hairline"
                />
              </div>
              <span className="w-14 h-14 rounded-2xl bg-ink-950 text-paper-0 flex items-center justify-center font-bold text-[16px]">
                QR
              </span>
              <div className="mt-5">
                <T
                  ctx={ctx}
                  k={k('card3_channel')}
                  as="div"
                  className="mono text-[10px] uppercase tracking-widest text-ink-500"
                />
                <T
                  ctx={ctx}
                  k={k('card3_name')}
                  as="div"
                  className="serif text-[36px] leading-none mt-1"
                />
              </div>
              <T
                ctx={ctx}
                k={k('card3_headline')}
                as="h3"
                className="text-[15px] font-semibold mt-4"
              />
              <T
                ctx={ctx}
                k={k('card3_desc')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />
              <ul className="mt-5 space-y-1.5 hairline-t pt-4">
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card3_spec1_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card3_spec1_value')}
                    as="span"
                    className="mono text-[10.5px] text-wa-deep font-semibold"
                  />
                </li>
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card3_spec2_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card3_spec2_value')}
                    as="span"
                    className="mono text-[10.5px] text-wa-deep font-semibold"
                  />
                </li>
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card3_spec3_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card3_spec3_value')}
                    as="span"
                    className="mono text-[10.5px] text-wa-deep font-semibold"
                  />
                </li>
                <li className="flex items-center justify-between text-[12px]">
                  <T ctx={ctx} k={k('card3_spec4_label')} as="span" className="text-ink-700" />
                  <T
                    ctx={ctx}
                    k={k('card3_spec4_value')}
                    as="span"
                    className="mono text-[10.5px] text-ink-500"
                  />
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
