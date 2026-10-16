import Link from 'next/link';
import type { CmsSection } from '@crm/contracts';
import { T, type SiteCtx } from './site-ui';
import { mk, vd } from './tw-common';

interface P {
  ctx: SiteCtx;
  def: CmsSection;
}

export function HeroFeatures({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="relative overflow-hidden bg-paper-0">
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none"></div>
        <div className="absolute -top-32 -right-32 w-[520px] h-[520px] rounded-full bg-wa-mint/50 blur-bub"></div>
        <div className="absolute -bottom-40 -left-32 w-[460px] h-[460px] rounded-full bg-accent-amber/15 blur-bub"></div>

        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[18%] left-[3%] opacity-30 rotate-[-8deg]">
            <div className="bg-wa-bubble hairline border-wa-green/30 rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-[0_8px_24px_-8px_rgba(50,20,219,0.3)]">
              <div className="text-[12px] font-medium text-wa-deep">🌷 Order shipped</div>
              <div className="text-[9px] text-wa-deep/60 mono text-right">14:08 ✓✓</div>
            </div>
          </div>
          <div className="absolute top-[72%] left-[5%] opacity-25 rotate-[5deg]">
            <div className="bg-white hairline rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-[0_8px_24px_-8px_rgba(50,20,219,0.3)]">
              <div className="text-[12px] font-medium text-ink-900">Track order →</div>
              <div className="text-[9px] text-ink-500 mono text-right">14:10</div>
            </div>
          </div>
          <div className="absolute top-[20%] right-[4%] opacity-30 rotate-[7deg]">
            <div className="bg-white hairline rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-[0_8px_24px_-8px_rgba(50,20,219,0.3)]">
              <div className="text-[12px] font-medium text-ink-900">+10% off coupon 🎁</div>
              <div className="text-[9px] text-ink-500 mono text-right">14:11</div>
            </div>
          </div>
        </div>

        <div className="relative max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-7 py-28">
          <div className="flex items-center justify-between mb-10">
            <div className="inline-flex items-center gap-2 hairline rounded-full px-3 py-1.5 bg-white text-[11px] mono uppercase tracking-widest text-ink-700">
              <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>
              <T ctx={ctx} k={k('eyebrow')} as="span" />
            </div>
            <div className="hidden lg:flex items-center gap-5 text-[11px] mono uppercase tracking-widest text-ink-500">
              <span className="text-wa-deep">read time · 4 min</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end reveal">
            <div className="col-span-12 lg:col-span-8">
              <T
                ctx={ctx}
                k={k('headline')}
                as="h1"
                className="serif text-[44px] sm:text-[64px] lg:text-[104px] leading-[0.92] tracking-[-0.025em]"
              />

              <div className="mt-8 flex flex-wrap gap-2">
                <span className="rounded-full bg-wa-deep text-paper-0 px-3 py-1.5 text-[11.5px] mono font-semibold">
                  Omnichannel · WhatsApp · Instagram · Facebook · Telegram · TikTok · SMS
                </span>
                {[
                  'Team Inbox',
                  'Broadcasts',
                  'Flow Builder · AI',
                  'WA Campaigns · A/B',
                  'Templates',
                  'Auto-Reply',
                  'Meta Ads · CTWA',
                  'AI Agents · RAG',
                  'Catalog · Storefront',
                  'Appointments',
                  'Chatbot Widgets',
                  'WA Forms',
                  'Chat Links',
                  'Engines · WABA / Twilio',
                  'Integrations',
                  'WA Calling',
                  'Webhooks · API',
                ].map((chip) => (
                  <span
                    key={chip}
                    className="hairline rounded-full bg-white px-3 py-1.5 text-[11.5px] mono"
                  >
                    {chip}
                  </span>
                ))}
                <span className="hairline rounded-full bg-wa-deep text-paper-0 px-3 py-1.5 text-[11.5px] mono">
                  Security · SOC 2
                </span>
              </div>
            </div>

            <div
              className="col-span-12 lg:col-span-4 flex flex-col gap-5 reveal"
              style={vd('120ms')}
            >
              <T
                ctx={ctx}
                k={k('subtitle')}
                as="p"
                className="text-[15.5px] text-ink-700 leading-relaxed border-s-2 border-wa-deep ps-4"
              />

              <div className="grid grid-cols-3 gap-0 hairline-t hairline-b py-4">
                <div className="hairline-r pe-4">
                  <div className="serif text-[32px] leading-none tabular text-wa-deep">
                    530<span className="text-[18px] text-ink-500">+</span>
                  </div>
                  <div className="mono text-[9px] uppercase tracking-widest text-ink-500 mt-1.5">
                    capabilities
                  </div>
                </div>
                <div className="hairline-r px-4">
                  <div className="serif text-[32px] leading-none tabular text-wa-deep">3</div>
                  <div className="mono text-[9px] uppercase tracking-widest text-ink-500 mt-1.5">
                    engines
                  </div>
                </div>
                <div className="ps-4">
                  <div className="serif text-[32px] leading-none tabular text-wa-deep">1</div>
                  <div className="mono text-[9px] uppercase tracking-widest text-ink-500 mt-1.5">
                    bill
                  </div>
                </div>
              </div>

              <div className="hairline rounded-2xl bg-white p-4">
                <div className="mono text-[10px] uppercase tracking-widest text-ink-500 mb-3">
                  Jump to
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[11.5px]">
                  <Link
                    href="#feat-1"
                    className="flex items-center gap-1.5 text-ink-700 hover:text-wa-deep"
                  >
                    <span className="serif text-wa-deep">01</span>Team Inbox
                  </Link>
                  <Link
                    href="#feat-2"
                    className="flex items-center gap-1.5 text-ink-700 hover:text-wa-deep"
                  >
                    <span className="serif text-wa-deep">02</span>Broadcasts
                  </Link>
                  <Link
                    href="#feat-3"
                    className="flex items-center gap-1.5 text-ink-700 hover:text-wa-deep"
                  >
                    <span className="serif text-wa-deep">03</span>Flow Builder
                  </Link>
                  <Link
                    href="#feat-7"
                    className="flex items-center gap-1.5 text-ink-700 hover:text-wa-deep"
                  >
                    <span className="serif text-wa-deep">07</span>Meta Ads CTWA
                  </Link>
                  <Link
                    href="#feat-8"
                    className="flex items-center gap-1.5 text-ink-700 hover:text-wa-deep"
                  >
                    <span className="serif text-wa-deep">08</span>AI Agents
                  </Link>
                  <Link
                    href="#feat-17"
                    className="flex items-center gap-1.5 text-ink-700 hover:text-wa-deep"
                  >
                    <span className="serif text-wa-deep">17</span>WA Calling
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

export function FeatureBento({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-paper-50 hairline-t hairline-b">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-7 py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-5">
            <Link
              id="feat-1"
              href="/register"
              className="col-span-12 lg:col-span-7 feat-card hairline rounded-3xl bg-white p-8 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="feature-num text-[64px]">01</div>
                  <T
                    ctx={ctx}
                    k={k('card1_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-2"
                  />
                </div>
                <span className="pill bg-wa-bubble text-wa-deep">
                  <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>
                  <T ctx={ctx} k={k('card1_badge')} as="span" />
                </span>
              </div>
              <T
                ctx={ctx}
                k={k('card1_title')}
                as="h3"
                className="serif text-[40px] leading-[0.95]"
              />
              <T
                ctx={ctx}
                k={k('card1_body')}
                as="p"
                className="text-[13px] text-ink-600 mt-3 leading-relaxed max-w-md"
              />

              <div className="feat-mock mt-6 hairline rounded-2xl bg-paper-50 overflow-hidden grid grid-cols-12">
                <div className="col-span-3 hairline-r p-2.5 bg-white">
                  <div className="mono text-[8px] uppercase tracking-widest text-ink-500 mb-2">
                    All open · 14
                  </div>
                  <div className="space-y-1.5">
                    <div className="bg-wa-bubble/40 hairline rounded-md px-2 py-1.5">
                      <div className="flex items-center justify-between text-[10px] font-semibold">
                        Maya R.<span className="mono text-[8px] text-wa-deep">2m</span>
                      </div>
                      <div className="flex gap-1 mt-1">
                        <span className="pill bg-paper-50 text-ink-700 text-[8px]">vip</span>
                        <span className="pill bg-accent-coral/15 text-accent-coral text-[8px]">
                          delivery
                        </span>
                      </div>
                    </div>
                    <div className="px-2 py-1.5">
                      <div className="flex items-center justify-between text-[10px]">
                        Anish K.<span className="mono text-[8px] text-accent-coral">SLA</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-span-5 chat-grid p-2 space-y-1">
                  <div className="flex">
                    <div className="bg-white rounded-md rounded-ss-sm px-2 py-1 max-w-[80%] shadow-sm">
                      <div className="text-[9.5px]">order #4218 says delivered 😕</div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-wa-bubble rounded-md rounded-se-sm px-2 py-1 max-w-[80%] shadow-sm">
                      <div className="text-[8px] text-wa-deep font-semibold mb-0.5">
                        ⟳ FLOW · order_lookup
                      </div>
                      <div className="text-[9.5px]">Left at apt 4B</div>
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <div className="hairline border-accent-amber/30 bg-accent-amber/10 rounded-md px-2 py-1">
                      <div className="text-[8px] text-[#8B5A14]">@sara · offer 10% credit</div>
                    </div>
                  </div>
                </div>
                <div className="col-span-4 p-2 bg-white">
                  <div className="mono text-[8px] uppercase tracking-widest text-ink-500 mb-1.5">
                    Customer 360
                  </div>
                  <div className="space-y-1 text-[9.5px]">
                    <div className="flex justify-between">
                      <span className="text-ink-500">Status</span>
                      <span className="font-semibold text-wa-deep">VIP</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-500">Orders</span>
                      <span className="font-semibold">12</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-500">LTV</span>
                      <span className="font-semibold">$1,840</span>
                    </div>
                  </div>
                  <div className="hairline-t mt-2 pt-1.5">
                    <div className="mono text-[8px] text-wa-deep">SLA timers</div>
                    <div className="mono text-[8px] text-ink-500">Sara K. · assigned</div>
                  </div>
                </div>
              </div>

              <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-ink-700">
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>Kanban board · drag-drop
                </li>
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>Presence · typing · collision
                </li>
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>Routing rules · auto-assign
                </li>
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>Internal notes · @mentions
                </li>
              </ul>

              <div className="hairline-t mt-6 pt-4 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">SLA · routing · AI agents</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open team inbox →</span>
              </div>
            </Link>

            <Link
              id="feat-2"
              href="/register"
              className="col-span-12 lg:col-span-5 feat-card hairline rounded-3xl bg-white p-7 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="feature-num text-[64px]">02</div>
                  <T
                    ctx={ctx}
                    k={k('card2_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-2"
                  />
                </div>
                <T
                  ctx={ctx}
                  k={k('card2_badge')}
                  as="span"
                  className="pill bg-wa-bubble text-wa-deep"
                />
              </div>
              <T
                ctx={ctx}
                k={k('card2_title')}
                as="h3"
                className="serif text-[32px] leading-[0.95]"
              />
              <T
                ctx={ctx}
                k={k('card2_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-3 leading-relaxed"
              />

              <div className="feat-mock mt-5 hairline rounded-2xl bg-paper-50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold"
                      style={{ background: 'linear-gradient(135deg,#E87A5D,#E5A04E)' }}
                    >
                      SP
                    </span>
                    <div className="text-[11px] font-semibold">Spring Promo · 48,210</div>
                  </div>
                  <span className="pill bg-wa-green/15 text-wa-deep text-[9px]">
                    <span className="w-1 h-1 rounded-full blink-green"></span>Sending
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-2 rounded-full bg-paper-100 overflow-hidden flex">
                    <div className="h-full bg-wa-deep bar-grow" style={{ width: '55%' }}></div>
                    <div className="h-full bg-wa-green bar-grow" style={{ width: '33%' }}></div>
                  </div>
                  <span className="mono text-[10px] font-semibold ticker">88%</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 text-center">
                  <div className="hairline rounded-lg bg-white py-1.5">
                    <div className="mono text-[8px] text-ink-500">SENT</div>
                    <div className="serif text-[14px] ticker">42.1k</div>
                  </div>
                  <div className="hairline rounded-lg bg-white py-1.5">
                    <div className="mono text-[8px] text-ink-500">DELIV</div>
                    <div className="serif text-[14px]">98%</div>
                  </div>
                  <div className="hairline border-wa-green/40 rounded-lg bg-wa-bubble py-1.5">
                    <div className="mono text-[8px] text-wa-deep">OPEN</div>
                    <div className="serif text-[14px] text-shimmer">86%</div>
                  </div>
                  <div className="hairline rounded-lg bg-white py-1.5">
                    <div className="mono text-[8px] text-ink-500">CLICK</div>
                    <div className="serif text-[14px]">11.4%</div>
                  </div>
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">per-recipient ledger</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-5">
            <Link
              id="feat-3"
              href="/register"
              className="col-span-12 lg:col-span-5 feat-card hairline rounded-3xl bg-white p-7 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="feature-num text-[64px]">03</div>
                  <T
                    ctx={ctx}
                    k={k('card3_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-2"
                  />
                </div>
                <T
                  ctx={ctx}
                  k={k('card3_badge')}
                  as="span"
                  className="pill bg-wa-bubble text-wa-deep"
                />
              </div>
              <T
                ctx={ctx}
                k={k('card3_title')}
                as="h3"
                className="serif text-[32px] leading-[0.95]"
              />
              <T
                ctx={ctx}
                k={k('card3_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-3 leading-relaxed"
              />

              <div className="feat-mock mt-5 hairline rounded-2xl bg-paper-50 grid-bg p-4 relative h-[170px] overflow-hidden">
                <div className="absolute top-3 left-3 hairline rounded-lg bg-white shadow-md p-2 w-[100px] float-y">
                  <div className="flex items-center gap-1 mono text-[7px] uppercase tracking-widest text-accent-coral">
                    <span className="w-1 h-1 rounded-full bg-accent-coral"></span>trigger
                  </div>
                  <div className="text-[10px] font-semibold mt-0.5">Cart abandon</div>
                </div>
                <svg
                  className="absolute top-[30px] left-[110px] w-[55px] h-[35px] text-wa-green"
                  viewBox="0 0 55 35"
                  fill="none"
                >
                  <path
                    className="flow-line"
                    d="M0 5 Q 27 5, 27 17 T 55 30"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                </svg>
                <div className="absolute top-[50px] left-[155px] hairline rounded-lg bg-white shadow-md p-2 w-[90px] float-y-2">
                  <div className="flex items-center gap-1 mono text-[7px] uppercase tracking-widest text-accent-amber">
                    <span className="w-1 h-1 rounded-full bg-accent-amber"></span>delay
                  </div>
                  <div className="text-[10px] font-semibold mt-0.5">Wait 1h</div>
                </div>
                <svg
                  className="absolute top-[80px] left-[240px] w-[40px] h-[30px] text-wa-green"
                  viewBox="0 0 40 30"
                  fill="none"
                >
                  <path
                    className="flow-line"
                    d="M0 5 Q 20 5, 20 15 T 40 25"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                </svg>
                <div className="absolute top-[100px] right-3 hairline border-wa-green/40 rounded-lg bg-wa-bubble shadow-md p-2 w-[110px] float-y-3">
                  <div className="flex items-center gap-1 mono text-[7px] uppercase tracking-widest text-wa-deep">
                    <span className="w-1 h-1 rounded-full bg-wa-green pulse-dot"></span>ai responder
                  </div>
                  <div className="text-[10px] font-semibold mt-0.5">cart_back · 5%</div>
                </div>
                <div className="absolute bottom-2 left-2 mono text-[8px] text-ink-500 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>
                  <span className="text-shimmer font-semibold">14 nodes · AI generated</span>
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">Sheets · Docs · Forms · catalog</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>

            <Link
              id="feat-4"
              href="/register"
              className="col-span-12 lg:col-span-7 feat-card hairline rounded-3xl bg-white p-8 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="feature-num text-[64px]">04</div>
                  <T
                    ctx={ctx}
                    k={k('card4_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-2"
                  />
                </div>
                <T
                  ctx={ctx}
                  k={k('card4_badge')}
                  as="span"
                  className="pill bg-wa-bubble text-wa-deep"
                />
              </div>
              <T
                ctx={ctx}
                k={k('card4_title')}
                as="h3"
                className="serif text-[40px] leading-[0.95]"
              />
              <T
                ctx={ctx}
                k={k('card4_body')}
                as="p"
                className="text-[13px] text-ink-600 mt-3 leading-relaxed max-w-md"
              />

              <div className="feat-mock mt-6 grid grid-cols-2 gap-3">
                <div className="hairline rounded-xl bg-paper-50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold">Variant A · "🌸 Mom's Day"</span>
                    <span className="pill bg-wa-deep text-paper-0 text-[8px]">Winner</span>
                  </div>
                  <div className="mono text-[9px] text-ink-500">CTR 13.2% · CVR 4.1%</div>
                  <div className="mt-2 h-1.5 rounded-full bg-paper-100 overflow-hidden">
                    <div className="h-full bg-wa-deep" style={{ width: '78%' }}></div>
                  </div>
                </div>
                <div className="hairline rounded-xl bg-paper-50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold">Variant B · "Mom deserves"</span>
                    <span className="pill bg-paper-100 text-ink-500 text-[8px]">Lost</span>
                  </div>
                  <div className="mono text-[9px] text-ink-500">CTR 9.6% · CVR 2.8%</div>
                  <div className="mt-2 h-1.5 rounded-full bg-paper-100 overflow-hidden">
                    <div className="h-full bg-ink-400" style={{ width: '52%' }}></div>
                  </div>
                </div>
              </div>

              <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-ink-700">
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>6 message types
                </li>
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>AI copy generation
                </li>
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>A/B variants · auto-winner
                </li>
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>Start/pause/resume
                </li>
              </ul>

              <div className="hairline-t mt-6 pt-4 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">link tracking · opt-out · scheduled</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open campaigns →</span>
              </div>
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-5">
            <Link
              id="feat-5"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">05</div>
                  <T
                    ctx={ctx}
                    k={k('card5_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card5_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card5_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 hairline rounded-xl bg-paper-50 p-3 space-y-1.5">
                {['Button count', 'Variable syntax', 'Header constraint', 'Auth source'].map(
                  (rule) => (
                    <div key={rule} className="flex items-center justify-between text-[10.5px]">
                      <span className="text-ink-700">✓ {rule}</span>
                      <span className="mono text-wa-deep text-[9px]">pass</span>
                    </div>
                  ),
                )}
                <div className="flex items-center justify-between text-[10.5px] text-wa-deep font-semibold">
                  <span>30/30 rules</span>
                  <span className="mono text-[9px]">submit ready</span>
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">carousel · auth · standard</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>

            <Link
              id="feat-6"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">06</div>
                  <T
                    ctx={ctx}
                    k={k('card6_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card6_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card6_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 space-y-2">
                <div className="hairline rounded-xl bg-paper-50 p-2.5">
                  <div className="mono text-[9px] uppercase text-ink-500 mb-1.5">match · fuzzy</div>
                  <div className="flex flex-wrap gap-1">
                    <span className="pill bg-wa-bubble text-wa-deep text-[9px]">price</span>
                    <span className="pill bg-wa-bubble text-wa-deep text-[9px]">prce</span>
                    <span className="pill bg-wa-bubble text-wa-deep text-[9px]">priceing</span>
                  </div>
                </div>
                <div className="flex items-center justify-center text-wa-deep mono text-[9px]">
                  ↓ trigger
                </div>
                <div className="hairline rounded-xl bg-wa-bubble/40 border-wa-green/30 p-2.5">
                  <div className="mono text-[9px] uppercase text-wa-deep">A/B variant</div>
                  <div className="mono text-[10px] text-wa-deep font-semibold">
                    pricing_v3 · 54%
                  </div>
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">CSV import · A/B · multi-lang</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>

            <Link
              id="feat-7"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden relative"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">07</div>
                  <T
                    ctx={ctx}
                    k={k('card7_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="brand-tile w-8 h-8 rounded-lg bg-gradient-to-br from-[#0866FF] to-[#0064E0] text-white flex items-center justify-center p-1.5">
                    <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                      <path
                        d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.502 0 12.541 0 15.41c0 .917.165 1.704.488 2.334.493.965 1.262 1.583 2.343 1.583 1.21 0 2.142-.501 3.354-1.95.402-.476.789-1.001 1.156-1.572.367.571.754 1.096 1.156 1.572 1.212 1.449 2.144 1.95 3.354 1.95 1.081 0 1.85-.618 2.343-1.583.323-.63.488-1.417.488-2.334 0-2.869-.704-5.908-2.044-7.967C13.749 5.31 12.034 4.03 10.066 4.03c-1.213 0-2.244.448-3.151.448-.907 0-1.939-.448-3.151-.448z"
                        opacity=".95"
                      />
                    </svg>
                  </span>
                  <svg
                    viewBox="0 0 16 16"
                    className="w-3 h-3 text-ink-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M5 4l4 4-4 4" />
                  </svg>
                  <span className="brand-tile w-8 h-8 rounded-lg bg-[#7c3aed] text-white flex items-center justify-center p-1.5">
                    <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                      <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24z" />
                    </svg>
                  </span>
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card7_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card7_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 hairline rounded-xl bg-paper-50 p-3">
                <div className="flex items-center gap-1 mb-3">
                  <span className="w-5 h-5 rounded-full bg-wa-green text-ink-900 text-[8px] font-bold flex items-center justify-center">
                    ✓
                  </span>
                  <div className="flex-1 h-px bg-wa-green"></div>
                  <span className="w-5 h-5 rounded-full bg-wa-green text-ink-900 text-[8px] font-bold flex items-center justify-center">
                    ✓
                  </span>
                  <div className="flex-1 h-px bg-wa-green"></div>
                  <span className="w-5 h-5 rounded-full bg-wa-green text-ink-900 text-[8px] font-bold flex items-center justify-center">
                    ✓
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-wa-green to-paper-200"></div>
                  <span className="relative w-5 h-5">
                    <span className="pulse-ring"></span>
                    <span className="absolute inset-0 rounded-full bg-wa-deep text-paper-0 text-[8px] font-bold flex items-center justify-center">
                      4
                    </span>
                  </span>
                  <div className="flex-1 h-px bg-paper-200"></div>
                  <span className="w-5 h-5 rounded-full hairline text-ink-400 text-[8px] flex items-center justify-center">
                    5
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div>
                    <div className="serif text-[15px] text-wa-deep tabular ticker">2.3k</div>
                    <div className="mono text-[8px] text-ink-500">impr</div>
                  </div>
                  <div>
                    <div className="serif text-[15px] text-wa-deep tabular ticker">418</div>
                    <div className="mono text-[8px] text-ink-500">clicks</div>
                  </div>
                  <div>
                    <div className="serif text-[15px] text-wa-deep tabular text-shimmer">18.1%</div>
                    <div className="mono text-[8px] text-ink-500">CTR</div>
                  </div>
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">brief → AI copy → preview</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-5">
            <Link
              id="feat-8"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">08</div>
                  <T
                    ctx={ctx}
                    k={k('card8_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card8_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card8_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 hairline rounded-xl bg-paper-50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="relative w-7 h-7">
                    <span className="absolute inset-0 rounded-lg bg-wa-deep"></span>
                    <span className="absolute inset-0 rounded-lg flex items-center justify-center text-paper-0">
                      <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                        <circle cx="8" cy="8" r="3" opacity=".4" />
                        <circle
                          cx="8"
                          cy="8"
                          r="6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1"
                          opacity=".5"
                        />
                        <circle cx="8" cy="8" r="1.5" />
                      </svg>
                    </span>
                  </span>
                  <div className="flex-1">
                    <div className="text-[10.5px] font-semibold">Sales agent · GPT-4o</div>
                    <div className="mono text-[8px] text-wa-deep flex items-center gap-1">
                      <span className="w-1 h-1 rounded-full bg-wa-green pulse-dot"></span>active ·
                      142 queries
                    </div>
                  </div>
                </div>
                <div className="text-[9.5px] text-ink-600 leading-snug mb-2.5 hairline-t pt-2">
                  "Pricing FAQs · 142 chunks · 4 sources indexed"
                </div>
                <div className="grid grid-cols-5 gap-1">
                  <span className="brand-tile aspect-square rounded bg-[#10A37F] text-white flex items-center justify-center p-1">
                    <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                      <path d="M22.282 9.821a5.985 5.985 0 00-.516-4.91A6.046 6.046 0 0014.99 2.01 6.065 6.065 0 005.026 4.18 5.985 5.985 0 001.028 7.08a6.046 6.046 0 00.743 7.097 5.98 5.98 0 00.51 4.911 6.051 6.051 0 006.515 2.9A5.985 5.985 0 0013.26 24a6.056 6.056 0 005.772-4.206 5.99 5.99 0 003.997-2.9 6.056 6.056 0 00-.747-7.073z" />
                    </svg>
                  </span>
                  <span className="brand-tile aspect-square rounded bg-[#D97706] text-white flex items-center justify-center p-1.5">
                    <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                      <path d="M13.827 3.52h3.603L24 20.477h-3.603l-6.57-16.957zm-7.258 0h3.767L16.7 20.477h-3.674l-1.343-3.461H5.398l-1.344 3.46H.43L6.57 3.522zm.86 10.642h4.06l-2.03-5.226-2.03 5.226z" />
                    </svg>
                  </span>
                  <span className="brand-tile aspect-square rounded bg-gradient-to-br from-[#4285F4] to-[#9B72CB] text-white flex items-center justify-center p-1.5">
                    <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                      <path d="M12 0L9.6 9.6 0 12l9.6 2.4L12 24l2.4-9.6L24 12l-9.6-2.4z" />
                    </svg>
                  </span>
                  <span className="brand-tile aspect-square rounded bg-[#FA520F] text-white flex items-center justify-center p-1.5">
                    <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                      <path d="M3 4h4v4H3V4zm14 0h4v4h-4V4zM3 10h4v4H3v-4zm6 0h4v4H9v-4zm8 0h4v4h-4v-4zM3 16h4v4H3v-4zm14 0h4v4h-4v-4z" />
                    </svg>
                  </span>
                  <span className="brand-tile aspect-square rounded bg-ink-950 text-white flex items-center justify-center p-1.5">
                    <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                      <rect x="6" y="3" width="3" height="18" rx="1.5" />
                      <rect x="15" y="3" width="3" height="18" rx="1.5" />
                    </svg>
                  </span>
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">BYOK · 5 providers · RAG</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>

            <Link
              id="feat-9"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">09</div>
                  <T
                    ctx={ctx}
                    k={k('card9_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card9_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card9_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 chat-grid rounded-xl p-2.5">
                <div className="bg-white rounded-lg overflow-hidden shadow-sm">
                  <div className="flex gap-0.5 p-1">
                    {[
                      ['🌷', '€18'],
                      ['💐', '€24'],
                      ['🌸', '€32'],
                    ].map((e) => (
                      <div
                        key={e[0]}
                        className="relative w-12 h-12 rounded bg-gradient-to-br from-accent-coral/80 via-accent-amber/80 to-wa-green/80 overflow-hidden"
                      >
                        <div className="absolute inset-0 flex items-end justify-center pb-1">
                          <span className="text-[10px]">{e[0]}</span>
                        </div>
                        <div className="absolute bottom-0 inset-x-0 bg-black/40 text-white text-[7px] mono text-center py-0.5">
                          {e[1]}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="px-2 py-0.5 text-[9.5px] font-semibold">
                    Spring picks 🌷 · 3 items
                  </div>
                  <div className="hairline-t flex">
                    <button className="flex-1 py-1 text-[9px] text-wa-deep font-semibold">
                      Browse
                    </button>
                    <button className="flex-1 py-1 text-[9px] text-wa-deep font-semibold hairline-l">
                      Buy
                    </button>
                  </div>
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">Shopify · Woo · domain</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>

            <Link
              id="feat-10"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">10</div>
                  <T
                    ctx={ctx}
                    k={k('card10_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card10_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card10_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 hairline rounded-xl bg-paper-50 p-3 space-y-1.5">
                <div className="mono text-[9px] uppercase text-ink-500 mb-1">
                  Pick a slot · Tue 16
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <span className="text-center text-[9.5px] hairline rounded-md bg-white py-1 text-ink-500">
                    10:00
                  </span>
                  <span className="text-center text-[9.5px] hairline border-wa-green/40 rounded-md bg-wa-bubble py-1 text-wa-deep font-semibold">
                    11:30
                  </span>
                  <span className="text-center text-[9.5px] hairline rounded-md bg-white py-1 text-ink-500">
                    14:00
                  </span>
                  <span className="text-center text-[9.5px] hairline rounded-md bg-white py-1 text-ink-400 line-through">
                    15:00
                  </span>
                  <span className="text-center text-[9.5px] hairline rounded-md bg-white py-1 text-ink-500">
                    16:30
                  </span>
                  <span className="text-center text-[9.5px] hairline rounded-md bg-white py-1 text-ink-500">
                    17:00
                  </span>
                </div>
                <div className="hairline-t pt-1.5 mt-1 flex items-center gap-1 text-[9px] text-wa-deep">
                  <svg
                    viewBox="0 0 16 16"
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <circle cx="8" cy="8" r="6.5" />
                  </svg>
                  Google Meet link auto-generated
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">Calendar OAuth · Meet · tz</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-5">
            <Link
              id="feat-11"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">11</div>
                  <T
                    ctx={ctx}
                    k={k('card11_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card11_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card11_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 hairline rounded-xl bg-paper-50 p-3 relative h-[100px]">
                <div className="absolute bottom-3 right-3 w-12 h-12 rounded-full bg-wa-green text-ink-900 flex items-center justify-center shadow-lg">
                  <svg viewBox="0 0 16 16" className="w-5 h-5" fill="currentColor">
                    <path d="M8 1C4.5 1 2 3.5 2 7c0 1.2.4 2.3 1 3.2L2 13l2.8-1C5.6 12.6 6.8 13 8 13c3.5 0 6-2.5 6-6S11.5 1 8 1z" />
                  </svg>
                </div>
                <div className="absolute bottom-16 right-3 bg-white hairline rounded-lg rounded-br-sm shadow-sm px-2 py-1 text-[10px]">
                  Hi 👋 how can I help?
                </div>
                <div className="absolute top-3 left-3 mono text-[9px] text-ink-500">
                  browser · your-site.com
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">JS embed · rotate token</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>

            <Link
              id="feat-12"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">12</div>
                  <T
                    ctx={ctx}
                    k={k('card12_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card12_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card12_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 chat-grid rounded-xl p-2.5">
                <div className="bg-white rounded-lg overflow-hidden shadow-sm">
                  <div className="px-2 py-1.5">
                    <div className="text-[10px] font-semibold mb-2">Customer feedback</div>
                    <div className="space-y-1">
                      <div className="hairline rounded-md bg-paper-50 px-2 py-1 text-[9px]">
                        ○ How was your delivery?
                      </div>
                      <div className="hairline border-wa-green/40 rounded-md bg-wa-bubble px-2 py-1 text-[9px] text-wa-deep">
                        ● Excellent
                      </div>
                      <div className="hairline rounded-md bg-paper-50 px-2 py-1 text-[9px]">
                        ○ Anything to improve?
                      </div>
                    </div>
                    <button className="mt-2 w-full bg-wa-deep text-paper-0 rounded py-1 text-[9px] font-semibold">
                      Submit →
                    </button>
                  </div>
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">Meta Flows · 4 field types</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>

            <Link
              id="feat-13"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">13</div>
                  <T
                    ctx={ctx}
                    k={k('card13_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card13_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card13_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 hairline rounded-xl bg-paper-50 p-3">
                <div className="hairline rounded-md bg-white px-2.5 py-1.5 mono text-[10px] text-wa-deep mb-2">
                  {ctx.extras.host || 'example.com'}/l/sales
                </div>
                <div className="space-y-1 text-[10px]">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-700">Clicks · 24h</span>
                    <span className="mono font-semibold text-wa-deep">418</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-700">All time</span>
                    <span className="mono font-semibold">12,408</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-700">Top source</span>
                    <span className="mono text-ink-500">instagram</span>
                  </div>
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">slug · prefill · analytics</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-5">
            <Link
              id="feat-14"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">14</div>
                  <T
                    ctx={ctx}
                    k={k('card14_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card14_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card14_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 grid grid-cols-3 gap-2">
                <div className="hairline rounded-xl bg-paper-50 p-2.5 text-center relative">
                  <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full blink-green"></div>
                  <span className="brand-tile w-9 h-9 rounded-lg bg-[#7c3aed] text-white flex items-center justify-center mx-auto float-y">
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                      <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24z" />
                    </svg>
                  </span>
                  <div className="serif text-[11px] mt-1.5">Cloud API</div>
                  <div className="mono text-[8px] text-ink-500">primary</div>
                </div>
                <div className="hairline rounded-xl bg-paper-50 p-2.5 text-center">
                  <span className="brand-tile w-9 h-9 rounded-lg bg-[#F22F46] text-white flex items-center justify-center mx-auto float-y-2">
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                      <path d="M12 0C5.382 0 0 5.382 0 12s5.382 12 12 12 12-5.382 12-12S18.618 0 12 0zm0 21.479C6.768 21.479 2.521 17.232 2.521 12 2.521 6.768 6.768 2.521 12 2.521S21.479 6.768 21.479 12 17.232 21.479 12 21.479zm5.439-11.336a1.711 1.711 0 11-3.421 0 1.711 1.711 0 013.421 0zm0 4.18a1.711 1.711 0 11-3.421 0 1.711 1.711 0 013.421 0zm-4.18 0a1.711 1.711 0 11-3.421 0 1.711 1.711 0 013.421 0zm0-4.18a1.711 1.711 0 11-3.421 0 1.711 1.711 0 013.421 0z" />
                    </svg>
                  </span>
                  <div className="serif text-[11px] mt-1.5">Twilio</div>
                  <div className="mono text-[8px] text-ink-500">prod</div>
                </div>
                <div className="hairline rounded-xl bg-paper-50 p-2.5 text-center">
                  <span className="brand-tile w-9 h-9 rounded-lg bg-ink-950 text-white flex items-center justify-center mx-auto float-y-3">
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                      <path d="M3 3h6v6H3V3zm2 2v2h2V5H5zm10-2h6v6h-6V3zm2 2v2h2V5h-2zM3 15h6v6H3v-6zm2 2v2h2v-2H5zm10 0h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v2h-2v-2zm-2-4h-2v-2h2v2zm-2 4h2v2h-2v-2zm6-4v2h-2v-2h2z" />
                    </svg>
                  </span>
                  <div className="serif text-[11px] mt-1.5">Unofficial API</div>
                  <div className="mono text-[8px] text-ink-500">sandbox</div>
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">multi-device · auto-reconnect</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>

            <Link
              id="feat-15"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">15</div>
                  <T
                    ctx={ctx}
                    k={k('card15_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card15_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card15_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 grid grid-cols-4 gap-1.5">
                <span className="brand-tile aspect-square rounded-md bg-[#96BF48] text-white flex items-center justify-center p-2">
                  <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                    <path d="M15.4 4.16l-3.42.39c-.32-1.11-1.36-1.93-2.59-1.93-.07 0-.13.01-.2.02-.11-.13-.24-.27-.41-.44C8.18 1.74 7.5 1.5 6.83 1.5c-1.43 0-2.59 1.16-2.59 2.59 0 .56.18 1.08.48 1.5l-1.7.21c-.18.02-.32.16-.36.34L.96 19.45c-.05.21.09.42.31.46l13.55 2.45c.21.04.42-.1.45-.31l3.36-14.78c.04-.18-.07-.36-.25-.41z" />
                  </svg>
                </span>
                <span className="brand-tile aspect-square rounded-md bg-[#7F54B3] text-white flex items-center justify-center p-1.5">
                  <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                    <path d="M2.227 4C1 4 .009 4.997 0 6.224v8.13c0 1.234.998 2.232 2.226 2.232h10.609l4.853 2.7-1.1-2.7H21.78a2.23 2.23 0 002.226-2.232v-8.13A2.23 2.23 0 0021.779 4H2.227z" />
                  </svg>
                </span>
                <span className="brand-tile aspect-square rounded-md bg-[#FF7A59] text-white flex items-center justify-center p-2">
                  <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                    <path d="M18.164 7.93V5.084c.612-.292 1.012-.91 1.012-1.61 0-.99-.802-1.796-1.794-1.796-.99 0-1.794.802-1.794 1.793 0 .703.4 1.318 1.012 1.61V7.92a5.073 5.073 0 00-2.4.94L8.94 4.704c.052-.193.087-.392.087-.6 0-1.32-1.07-2.39-2.39-2.39A2.39 2.39 0 004.246 4.103c0 1.32 1.072 2.39 2.392 2.39.444 0 .855-.13 1.21-.337l5.155 4.013a5.057 5.057 0 00.815 7.142l-1.546 1.546a1.643 1.643 0 00-.412-.073c-.46 0-.836.376-.836.836s.376.836.836.836.836-.376.836-.836c0-.144-.038-.282-.106-.402l1.527-1.528a5.054 5.054 0 002.917.93c2.795 0 5.062-2.267 5.062-5.062 0-2.534-1.86-4.633-4.292-5.005l.36-2.624zm-2.797 7.625a2.6 2.6 0 11.001-5.2 2.6 2.6 0 010 5.2z" />
                  </svg>
                </span>
                <span className="brand-tile aspect-square rounded-md bg-white hairline flex items-center justify-center p-1.5">
                  <svg viewBox="0 0 24 24" className="w-full h-full">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0012 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 001 12c0 1.78.43 3.47 1.18 4.93l3.66-2.84z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                </span>
                <span className="brand-tile aspect-square rounded-md bg-[#0F9D58] text-white flex items-center justify-center p-2">
                  <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                    <path d="M4 2h11l5 5v13a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zm10 1.5V8h4.5L14 3.5zM6 11v2h4v-2H6zm6 0v2h6v-2h-6zm-6 4v2h4v-2H6zm6 0v2h6v-2h-6z" />
                  </svg>
                </span>
                <span className="brand-tile aspect-square rounded-md bg-[#4285F4] text-white flex items-center justify-center p-2">
                  <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                    <path d="M4 2h11l5 5v13a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zm10 1.5V8h4.5L14 3.5zM7 12h10v1.5H7V12zm0 3h10v1.5H7V15zm0 3h7v1.5H7V18z" />
                  </svg>
                </span>
                <span className="brand-tile aspect-square rounded-md bg-[#673AB7] text-white flex items-center justify-center p-2">
                  <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                    <path d="M4 2h11l5 5v13a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zm10 1.5V8h4.5L14 3.5zM8 11v1.5h8V11H8zm0 4v1.5h6V15H8z" />
                    <circle cx="6.5" cy="11.75" r=".8" />
                    <circle cx="6.5" cy="15.75" r=".8" />
                  </svg>
                </span>
                <span className="brand-tile aspect-square rounded-md hairline text-ink-700 flex items-center justify-center bg-paper-50 p-2">
                  <svg
                    viewBox="0 0 24 24"
                    className="w-full h-full"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                  >
                    <path d="M8 4l-6 8 6 8M16 4l6 8-6 8" />
                  </svg>
                </span>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">OAuth · webhooks · Sheets API</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>

            <Link
              id="feat-16"
              href="/register"
              className="col-span-12 lg:col-span-4 feat-card hairline rounded-3xl bg-white p-6 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="feature-num text-[52px]">16</div>
                  <T
                    ctx={ctx}
                    k={k('card16_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-1.5"
                  />
                </div>
              </div>
              <T
                ctx={ctx}
                k={k('card16_title')}
                as="h3"
                className="serif text-[26px] leading-tight"
              />
              <T
                ctx={ctx}
                k={k('card16_body')}
                as="p"
                className="text-[12.5px] text-ink-600 mt-2 leading-relaxed"
              />

              <div className="feat-mock mt-5 hairline rounded-xl bg-paper-50 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>
                  <span className="text-[10px] font-semibold flex-1">Weekly digest</span>
                  <span className="mono text-[9px] text-wa-deep">Mon 9:00</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-amber"></span>
                  <span className="text-[10px] flex-1 text-ink-700">Cart reminder · 4h</span>
                  <span className="mono text-[9px] text-ink-500">paused</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>
                  <span className="text-[10px] flex-1 text-ink-700">Renewal · monthly</span>
                  <span className="mono text-[9px] text-wa-deep">+2d</span>
                </div>
              </div>

              <div className="hairline-t mt-5 pt-3 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">pause · run-now · retry</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open →</span>
              </div>
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <Link
              id="feat-17"
              href="/register"
              className="col-span-12 lg:col-span-7 feat-card hairline rounded-3xl bg-white p-8 block overflow-hidden"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="feature-num text-[64px]">17</div>
                  <T
                    ctx={ctx}
                    k={k('card17_eyebrow')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-[0.22em] text-ink-500 mt-2"
                  />
                </div>
                <T
                  ctx={ctx}
                  k={k('card17_badge')}
                  as="span"
                  className="pill bg-wa-bubble text-wa-deep"
                />
              </div>
              <T
                ctx={ctx}
                k={k('card17_title')}
                as="h3"
                className="serif text-[40px] leading-[0.95]"
              />
              <T
                ctx={ctx}
                k={k('card17_body')}
                as="p"
                className="text-[13px] text-ink-600 mt-3 leading-relaxed max-w-md"
              />

              <div className="feat-mock mt-6 hairline rounded-2xl bg-paper-50 p-5">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <span className="absolute inset-0 rounded-full border-2 border-wa-green animate-ping"></span>
                    <span
                      className="w-14 h-14 rounded-full flex items-center justify-center text-paper-0 font-semibold text-[14px] relative"
                      style={{ background: 'linear-gradient(135deg,#E87A5D,#E5A04E)' }}
                    >
                      MR
                    </span>
                  </div>
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold">Maya Ramaswamy</div>
                    <div className="mono text-[10px] text-wa-deep flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>
                      connected · 2:14
                    </div>
                    <div className="mono text-[10px] text-ink-500 mt-0.5">
                      recording · transcript live
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="w-9 h-9 rounded-full bg-paper-100 flex items-center justify-center">
                      <svg
                        viewBox="0 0 16 16"
                        className="w-4 h-4 text-ink-700"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      >
                        <rect x="6" y="2" width="4" height="8" rx="2" />
                        <path d="M3 8a5 5 0 0010 0M8 13v2" />
                      </svg>
                    </button>
                    <button className="w-9 h-9 rounded-full bg-accent-coral flex items-center justify-center text-paper-0">
                      <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                        <path
                          d="M3 5C5 3.5 11 3.5 13 5c1 .8 1 2 0 3l-2 .5c-.6 0-1-.5-1-1V6c-1.3-.4-2.7-.4-4 0v1.5c0 .5-.4 1-1 1L3 8c-1-1-1-2.2 0-3z"
                          transform="rotate(135 8 8)"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-ink-700">
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>WebRTC SDP
                </li>
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>AI voicemail fallback
                </li>
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>3-way recording
                </li>
                <li className="flex gap-1.5">
                  <span className="text-wa-deep">→</span>Transcript playback
                </li>
              </ul>

              <div className="hairline-t mt-6 pt-4 flex items-center justify-between text-[12px]">
                <span className="mono text-ink-500">in/out · duration · status logs</span>
                <span className="text-wa-deep font-semibold feat-arrow">Open WA calling →</span>
              </div>
            </Link>

            <Link
              id="feat-18"
              href="/register"
              className="col-span-12 lg:col-span-5 feat-card rounded-3xl bg-ink-950 text-paper-0 p-8 block relative overflow-hidden"
            >
              <div className="absolute inset-0 dot-pattern opacity-15"></div>
              <div className="absolute -bottom-32 -right-32 w-[300px] h-[300px] rounded-full bg-wa-green/15 blur-bub"></div>
              <div className="relative">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="feature-num text-[64px] text-paper-0/25">18</div>
                    <T
                      ctx={ctx}
                      k={k('card18_eyebrow')}
                      as="div"
                      className="mono text-[10px] uppercase tracking-[0.22em] text-paper-0/60 mt-2"
                    />
                  </div>
                  <T
                    ctx={ctx}
                    k={k('card18_badge')}
                    as="span"
                    className="pill bg-wa-green text-ink-900"
                  />
                </div>
                <T
                  ctx={ctx}
                  k={k('card18_title')}
                  as="h3"
                  className="serif em-green text-[36px] leading-[0.95]"
                />
                <T
                  ctx={ctx}
                  k={k('card18_body')}
                  as="p"
                  className="text-[13px] text-paper-0/75 mt-3 leading-relaxed"
                />

                <div className="feat-mock mt-6 grid grid-cols-2 gap-2.5">
                  {[
                    ['2FA · all admins', 'required'],
                    ['IP allowlist', 'CIDR ranges'],
                    ['Scam patterns', 'hold + alert'],
                    ['Emergency stop', 'platform halt'],
                  ].map((r) => (
                    <div
                      key={r[0]}
                      className="border border-paper-0/15 rounded-xl bg-paper-0/5 p-2.5"
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-wa-green">✓</span>
                        <div className="text-[11px] font-semibold">{r[0]}</div>
                      </div>
                      <div className="mono text-[8.5px] text-paper-0/55">{r[1]}</div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-paper-0/15 mt-6 pt-4 flex items-center justify-between text-[12px]">
                  <span className="mono text-paper-0/55">SOC 2 · ISO · GDPR · audit log</span>
                  <span className="text-wa-green font-semibold feat-arrow">Open security →</span>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

export function PillarsThree({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-white">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-7 py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="col-span-12 lg:col-span-3">
              <span className="badge-num" {...a('eyebrow')}>
                — {ctx.fc(k('eyebrow'))}
              </span>
              <T
                ctx={ctx}
                k={k('headline')}
                as="h2"
                className="serif text-[40px] sm:text-[56px] leading-[0.92] tracking-[-0.02em] mt-6"
              />
              <svg
                viewBox="0 0 240 18"
                className="w-44 mt-5 text-wa-green"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M2 12 Q 60 2, 120 8 T 238 6" />
              </svg>
            </div>

            <div className="col-span-12 lg:col-span-9">
              <T
                ctx={ctx}
                k={k('intro')}
                as="p"
                className="serif text-[26px] sm:text-[36px] leading-[1.18] tracking-[-0.01em] text-ink-900"
              />

              <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="hairline rounded-2xl bg-paper-50 p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="badge-num">i</span>
                    <T
                      ctx={ctx}
                      k={k('pillar1_label')}
                      as="span"
                      className="mono text-[10px] uppercase tracking-widest text-ink-500"
                    />
                  </div>
                  <T
                    ctx={ctx}
                    k={k('pillar1_title')}
                    as="h3"
                    className="serif text-[24px] leading-tight"
                  />
                  <T
                    ctx={ctx}
                    k={k('pillar1_body')}
                    as="p"
                    className="text-[12.5px] text-ink-600 mt-3"
                  />
                </div>

                <div className="hairline rounded-2xl bg-paper-50 p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="badge-num">ii</span>
                    <T
                      ctx={ctx}
                      k={k('pillar2_label')}
                      as="span"
                      className="mono text-[10px] uppercase tracking-widest text-ink-500"
                    />
                  </div>
                  <T
                    ctx={ctx}
                    k={k('pillar2_title')}
                    as="h3"
                    className="serif text-[24px] leading-tight"
                  />
                  <T
                    ctx={ctx}
                    k={k('pillar2_body')}
                    as="p"
                    className="text-[12.5px] text-ink-600 mt-3"
                  />
                </div>

                <div className="hairline rounded-2xl bg-paper-50 p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="badge-num">iii</span>
                    <T
                      ctx={ctx}
                      k={k('pillar3_label')}
                      as="span"
                      className="mono text-[10px] uppercase tracking-widest text-ink-500"
                    />
                  </div>
                  <T
                    ctx={ctx}
                    k={k('pillar3_title')}
                    as="h3"
                    className="serif text-[24px] leading-tight"
                  />
                  <T
                    ctx={ctx}
                    k={k('pillar3_body')}
                    as="p"
                    className="text-[12.5px] text-ink-600 mt-3"
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

export function PullQuote({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="bg-paper-50 hairline-t hairline-b">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-7 py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="col-span-12 lg:col-span-2">
              <svg viewBox="0 0 32 24" className="w-12 h-9 text-wa-deep" fill="currentColor">
                <path d="M6 0C2.7 0 0 2.7 0 6v6c0 3.3 2.7 6 6 6 1 0 1.5-.5 1.5-1.5S7 15 6 15c-1.7 0-3-1.3-3-3h3c1.7 0 3-1.3 3-3V6c0-3.3-2.7-6-3-6zm20 0c-3.3 0-6 2.7-6 6v6c0 3.3 2.7 6 6 6 1 0 1.5-.5 1.5-1.5S27 15 26 15c-1.7 0-3-1.3-3-3h3c1.7 0 3-1.3 3-3V6c0-3.3-2.7-6-3-6z" />
              </svg>
            </div>

            <div className="col-span-12 lg:col-span-10">
              <T
                ctx={ctx}
                k={k('quote')}
                as="p"
                className="serif text-[28px] sm:text-[48px] leading-[1.12] tracking-[-0.01em]"
              />

              <div className="mt-8 flex items-center gap-4 hairline-t pt-5 flex-wrap">
                <T
                  ctx={ctx}
                  k={k('author_initials')}
                  as="span"
                  className="w-12 h-12 rounded-full bg-gradient-to-br from-accent-coral to-accent-amber flex items-center justify-center text-paper-0 font-semibold"
                />
                <div className="flex-1 min-w-0">
                  <T ctx={ctx} k={k('author')} as="div" className="text-[14px] font-semibold" />
                  <T ctx={ctx} k={k('author_role')} as="div" className="text-[12px] text-ink-500" />
                </div>
                {[1, 2].map((i) => (
                  <div key={i} className="text-end">
                    <T
                      ctx={ctx}
                      k={k(`stat${i}_label`)}
                      as="div"
                      className="mono text-[10px] uppercase tracking-widest text-ink-500"
                    />
                    <T
                      ctx={ctx}
                      k={k(`stat${i}_value`)}
                      as="div"
                      className="serif text-[28px] text-wa-deep"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
