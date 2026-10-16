import Link from 'next/link';
import type { ReactNode } from 'react';
import type { CmsSection } from '@crm/contracts';
import { T, type SiteCtx } from './site-ui';
import { has, mk, vd } from './tw-common';

interface P {
  ctx: SiteCtx;
  def: CmsSection;
}

export function HeroHome({ ctx, def, children }: P & { children?: ReactNode }) {
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
          <div className="absolute top-[4%] left-[2%] opacity-30 rotate-[-8deg]">
            <div className="bg-wa-bubble hairline border-wa-green/30 rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-[0_8px_24px_-8px_rgba(50,20,219,0.3)]">
              <div className="text-[12px] font-medium text-wa-deep">🌷 Order shipped</div>
              <div className="text-[9px] text-wa-deep/60 mono text-right">14:08 ✓✓</div>
            </div>
          </div>
          <div className="absolute top-[93%] left-[2%] opacity-25 rotate-[5deg]">
            <div className="bg-white hairline rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-[0_8px_24px_-8px_rgba(50,20,219,0.3)]">
              <div className="text-[12px] font-medium text-ink-900">Out for delivery</div>
              <div className="text-[9px] text-ink-500 mono text-right">14:09</div>
            </div>
          </div>
          <div className="absolute top-[4%] right-[2%] opacity-30 rotate-[7deg]">
            <div className="bg-white hairline rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-[0_8px_24px_-8px_rgba(50,20,219,0.3)]">
              <div className="text-[12px] font-medium text-ink-900">Track order →</div>
              <div className="text-[9px] text-ink-500 mono text-right">14:10</div>
            </div>
          </div>
          <div className="absolute top-[93%] right-[2%] opacity-25 rotate-[-6deg]">
            <div className="bg-wa-bubble hairline border-wa-green/30 rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-[0_8px_24px_-8px_rgba(50,20,219,0.3)]">
              <div className="text-[12px] font-medium text-wa-deep">+10% off coupon 🎁</div>
              <div className="text-[9px] text-wa-deep/60 mono text-right">14:11 ✓✓</div>
            </div>
          </div>
        </div>

        <div className="relative max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-7 py-28">
          <div className="flex items-center justify-between mb-10">
            <div className="inline-flex items-center gap-2 hairline rounded-full px-3 py-1.5 bg-white text-[11px] mono uppercase tracking-widest text-ink-700">
              <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>
              <span>
                <T ctx={ctx} k={k('eyebrow')} as="span" />
              </span>
            </div>
            <div className="hidden lg:flex items-center gap-6 text-[11px] mono uppercase tracking-widest text-ink-500">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-wa-green"></span>
                <T ctx={ctx} k={k('stat1_label')} as="span" />
              </span>
              <span className="text-ink-400">/</span>
              <T ctx={ctx} k={k('stat2_label')} as="span" />
              <span className="text-ink-400">/</span>
              <T ctx={ctx} k={k('stat3_label')} as="span" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-end">
            <div className="col-span-12 lg:col-span-9 reveal">
              <T
                ctx={ctx}
                k={k('headline')}
                as="h1"
                className="serif text-[44px] sm:text-[64px] lg:text-[112px] leading-[0.92] tracking-[-0.025em]"
              />
            </div>

            <div className="col-span-12 lg:col-span-3 reveal" style={vd('120ms')}>
              <T
                ctx={ctx}
                k={k('subtitle')}
                as="p"
                className="text-[14px] text-ink-700 leading-relaxed border-s-2 border-wa-deep ps-4"
              />
              <div className="mt-6 flex flex-col gap-2.5">
                <Link
                  href={ctx.fc(k('cta1_url')) || '#'}
                  {...u('cta1_url')}
                  className="w-full px-5 py-3 rounded-full bg-wa-green text-ink-900 text-[13.5px] font-semibold hover:bg-[#1ec05a] flex items-center justify-center gap-2 glow-green"
                >
                  <T ctx={ctx} k={k('cta1_label')} as="span" />
                  <svg
                    viewBox="0 0 16 16"
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M5 4l4 4-4 4" />
                  </svg>
                </Link>
                <Link
                  href={ctx.fc(k('cta2_url')) || '#'}
                  {...u('cta2_url')}
                  className="w-full px-5 py-3 hairline rounded-full bg-white text-[13.5px] font-medium hover:bg-paper-50 flex items-center justify-center gap-2"
                >
                  <span className="w-5 h-5 rounded-full bg-wa-deep text-paper-0 flex items-center justify-center">
                    <svg viewBox="0 0 16 16" className="w-2.5 h-2.5" fill="currentColor">
                      <polygon points="5,3 13,8 5,13" />
                    </svg>
                  </span>
                  <T ctx={ctx} k={k('cta2_label')} as="span" />
                </Link>
              </div>
            </div>
          </div>

          {children}
        </div>
      </section>
    </>
  );
}

export function TwoDeviceStage({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <div className="relative mt-20 overflow-x-clip">
        <svg
          className="absolute inset-x-0 top-0 w-full h-[560px] pointer-events-none"
          viewBox="0 0 1200 560"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="arcg" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#3214db" stopOpacity=".0" />
              <stop offset=".18" stopColor="#3214db" stopOpacity=".5" />
              <stop offset=".5" stopColor="#7c3aed" stopOpacity="1" />
              <stop offset=".82" stopColor="#3214db" stopOpacity=".5" />
              <stop offset="1" stopColor="#3214db" stopOpacity=".0" />
            </linearGradient>
          </defs>
          <path
            d="M 340 360 Q 600 -40, 860 320"
            stroke="#7c3aed"
            strokeOpacity=".18"
            strokeWidth="10"
            fill="none"
            strokeLinecap="round"
          />
          <path
            className="arc-line"
            d="M 340 360 Q 600 -40, 860 320"
            stroke="url(#arcg)"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
        </svg>

        <div className="absolute left-1/2 -translate-x-1/2 top-2 z-30">
          <div className="hairline glass rounded-full px-3 py-1.5 inline-flex items-center gap-2 shadow-sm">
            <svg
              viewBox="0 0 16 16"
              className="w-3 h-3 text-wa-deep"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M2 8h12M14 8l-3-3M14 8l-3 3" />
            </svg>
            <span className="mono text-[10px] uppercase tracking-widest text-ink-700">
              message · 18ms · encrypted
            </span>
            <span className="text-ink-400">·</span>
            <span className="mono text-[10px] uppercase tracking-widest text-wa-deep">
              delivered
            </span>
          </div>
        </div>

        <T ctx={ctx} k={k('fly1')} as="div" className="fly-msg fly-1" />
        <T ctx={ctx} k={k('fly2')} as="div" className="fly-msg fly-2" />
        <T ctx={ctx} k={k('fly3')} as="div" className="fly-msg fly-3" />

        <div className="trail-dot t1"></div>
        <div className="trail-dot t2"></div>
        <div className="trail-dot t3"></div>

        <div className="landing-pulse lp1"></div>
        <div className="landing-pulse lp2"></div>
        <div className="landing-pulse lp3"></div>

        <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-6 items-center pt-12">
          <div className="col-span-12 lg:col-span-5 relative reveal">
            <div
              className="hairline rounded-3xl bg-white shadow-2xl overflow-hidden float-y"
              style={{
                boxShadow: '0 30px 80px -30px rgba(50,20,219,.35), 0 0 0 1px rgba(50,20,219,.05)',
              }}
            >
              <div className="flex items-center gap-2 px-4 py-3 hairline-b bg-paper-50">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-accent-coral/70"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-accent-amber/80"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-wa-green"></span>
                </div>
                <div className="hairline rounded-md bg-white px-3 py-1 mono text-[10px] text-ink-500 ms-2 min-w-0 truncate">
                  app.{ctx.extras.host || 'example.com'}/campaigns/spring
                </div>
                <span className="ms-auto mono text-[9.5px] uppercase tracking-widest text-ink-500">
                  sender
                </span>
              </div>

              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold"
                      style={{ background: 'linear-gradient(135deg,#E87A5D,#E5A04E)' }}
                    >
                      SP
                    </span>
                    <div>
                      <div className="text-[12.5px] font-semibold">Spring Promo · Tier-2 EU</div>
                      <div className="mono text-[9.5px] text-ink-500">
                        spring_promo_v3 · 48,210 recipients
                      </div>
                    </div>
                  </div>
                  <span className="pill bg-wa-green/15 text-wa-deep border border-wa-green/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>Sending
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <div className="flex-1 h-2 rounded-full bg-paper-100 overflow-hidden flex">
                    <div className="h-full bg-wa-deep" style={{ width: '55%' }}></div>
                    <div className="h-full bg-wa-green" style={{ width: '33%' }}></div>
                  </div>
                  <span className="mono text-[10px] tabular font-semibold">88%</span>
                </div>

                <div className="hairline rounded-xl bg-paper-50 p-3 mb-4">
                  <div className="mono text-[9.5px] uppercase tracking-widest text-ink-500 mb-1.5">
                    message · template
                  </div>
                  <div className="text-[12.5px] leading-snug">
                    🌷 <b>Mother&apos;s Day Promo</b> — 20% off blooms, free delivery in EU.
                    <span className="text-ink-500">
                      Use code <span className="mono text-wa-deep">MOM20</span>
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="flex items-center gap-1.5 mono text-[10px] text-ink-500">
                      <span className="w-1 h-1 rounded-full bg-wa-deep typing-dot"></span>
                      <span className="w-1 h-1 rounded-full bg-wa-deep typing-dot"></span>
                      <span className="w-1 h-1 rounded-full bg-wa-deep typing-dot"></span>
                      <span className="ms-1">sending wave 3 of 5…</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="grid grid-cols-3 gap-2 flex-1">
                    <div className="hairline rounded-lg bg-paper-50 py-2 text-center">
                      <div className="mono text-[9px] text-ink-500">SENT</div>
                      <div className="serif text-[18px] tabular">42.1k</div>
                    </div>
                    <div className="hairline rounded-lg bg-wa-bubble border-wa-green/30 py-2 text-center">
                      <div className="mono text-[9px] text-wa-deep">READ</div>
                      <div className="serif text-[18px] tabular text-wa-deep">86%</div>
                    </div>
                    <div className="hairline rounded-lg bg-paper-50 py-2 text-center">
                      <div className="mono text-[9px] text-ink-500">CTR</div>
                      <div className="serif text-[18px] tabular">11.4%</div>
                    </div>
                  </div>
                  <div className="relative ms-4 w-12 h-12">
                    <span className="ring-out"></span>
                    <span className="ring-out r2"></span>
                    <span className="ring-out r3"></span>
                    <button className="relative w-12 h-12 rounded-full bg-wa-green text-ink-900 flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
                      <svg
                        viewBox="0 0 24 24"
                        className="w-5 h-5 -translate-x-[1px] translate-y-[1px]"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M22 2L11 13" />
                        <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 mono text-[10.5px] uppercase tracking-widest text-ink-500 text-center">
              sender · dashboard · {(ctx.extras.brand || 'brand').toLowerCase()}
            </div>
          </div>

          <div
            className="hidden lg:flex col-span-2 flex-col items-center justify-end gap-2.5 relative"
            style={{ zIndex: '35', paddingTop: '120px' }}
          >
            <div className="absolute top-[125px] left-1/2 -translate-x-1/2 w-px h-[calc(100%-130px)] bg-gradient-to-b from-wa-green/0 via-wa-green/60 to-wa-deep/0"></div>

            <div className="relative hairline glass rounded-2xl bg-white px-5 py-4 shadow-md text-center w-[140px]">
              <div className="mono text-[9px] uppercase tracking-[0.18em] text-wa-deep mb-1.5 flex items-center justify-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>in flight
              </div>
              <div className="serif text-[40px] leading-none text-wa-deep tabular">
                18<span className="text-[18px] text-ink-500 ms-0.5">ms</span>
              </div>
              <div className="mono text-[9px] uppercase tracking-widest text-ink-500 mt-1.5">
                avg latency
              </div>
            </div>

            <div className="relative hairline glass rounded-xl bg-white px-3 py-2 w-[140px]">
              <div className="mono text-[9px] text-ink-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                <svg
                  viewBox="0 0 12 12"
                  className="w-2.5 h-2.5 text-wa-deep"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M6 1l5 3v4l-5 3-5-3V4z" />
                </svg>
                payload
              </div>
              <div className="mono text-[10px] text-ink-700">whatsapp/v17</div>
              <div className="mono text-[10px] text-wa-deep">cloud_api · enc</div>
            </div>

            <div className="relative hairline glass rounded-xl bg-white px-3 py-2 w-[140px]">
              <div className="mono text-[9px] text-ink-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                <svg
                  viewBox="0 0 12 12"
                  className="w-2.5 h-2.5 text-wa-deep"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M2 6l3 3 5-6" />
                </svg>
                checks · 3/3
              </div>
              <div className="flex items-center gap-1.5 text-[10.5px]">
                <span className="text-wa-green">✓</span>opt-in
              </div>
              <div className="flex items-center gap-1.5 text-[10.5px]">
                <span className="text-wa-green">✓</span>quiet hours
              </div>
              <div className="flex items-center gap-1.5 text-[10.5px]">
                <span className="text-wa-green">✓</span>rate limit
              </div>
            </div>
          </div>

          <div
            className="col-span-12 lg:col-span-5 relative flex justify-center reveal"
            style={vd('200ms')}
          >
            <div className="relative w-full max-w-[340px] float-y-2">
              <div
                className="hairline rounded-2xl overflow-hidden shadow-2xl bg-white"
                style={{
                  boxShadow: '0 30px 80px -30px rgba(50,20,219,.45), 0 0 0 1px rgba(50,20,219,.05)',
                }}
              >
                <div className="bg-wa-deep text-paper-0 px-4 py-3 flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
                    style={{ background: 'linear-gradient(135deg,#E87A5D,#E5A04E)' }}
                  >
                    BL
                  </div>
                  <div className="flex-1 leading-tight">
                    <div className="text-[13px] font-semibold">Bloomly Flowers</div>
                    <div className="text-[10px] text-paper-0/70 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-wa-green pulse-dot"></span>online
                    </div>
                  </div>
                  <svg
                    viewBox="0 0 16 16"
                    className="w-4 h-4 text-paper-0/80"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M11.5 3a3 3 0 013 3v4a3 3 0 01-3 3h-7a3 3 0 01-3-3V6a3 3 0 013-3M2 4l6 4 6-4" />
                  </svg>
                  <svg viewBox="0 0 16 16" className="w-4 h-4 text-paper-0/80" fill="currentColor">
                    <circle cx="8" cy="3" r="1.4" />
                    <circle cx="8" cy="8" r="1.4" />
                    <circle cx="8" cy="13" r="1.4" />
                  </svg>
                </div>

                <div className="chat-grid px-3 py-3 space-y-2 min-h-[320px]">
                  <div className="flex justify-center">
                    <span className="bg-white/80 hairline rounded-full px-2.5 py-0.5 text-[9.5px] mono text-ink-500">
                      today · 14:08
                    </span>
                  </div>
                  <div className="flex">
                    <div className="bg-white rounded-lg rounded-ss-sm px-3 py-2 max-w-[80%] shadow-sm">
                      <div className="text-[12px]">Hi Maya 👋 quick note from the team.</div>
                      <div className="text-[9px] text-ink-500 mono text-end mt-0.5">14:08</div>
                    </div>
                  </div>

                  <div className="flex recv-pop">
                    <div className="bg-white rounded-lg rounded-ss-sm px-3 py-2 max-w-[80%] shadow-sm">
                      <T ctx={ctx} k={k('chat1')} as="div" className="text-[12px]" />
                      <div className="text-[9px] text-ink-500 mono text-end mt-0.5">
                        14:08 · just now
                      </div>
                    </div>
                  </div>
                  <div className="flex recv-pop-2">
                    <div className="bg-white rounded-lg rounded-ss-sm px-3 py-2 max-w-[80%] shadow-sm">
                      <T ctx={ctx} k={k('chat2')} as="div" className="text-[12px]" />
                      <div className="text-[9px] text-ink-500 mono text-end mt-0.5">
                        14:08 · just now
                      </div>
                    </div>
                  </div>
                  <div className="flex recv-pop-3">
                    <div className="bg-white rounded-lg rounded-ss-sm px-3 py-2 max-w-[80%] shadow-sm">
                      <T ctx={ctx} k={k('chat3')} as="div" className="text-[12px]" />
                      <div className="text-[9px] text-ink-500 mono text-end mt-0.5">
                        14:09 · just now
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <div className="bg-wa-bubble rounded-lg rounded-se-sm px-3 py-2 max-w-[78%] shadow-sm">
                      <div className="text-[12px]">Yes please! 💐</div>
                      <div className="text-[9px] text-wa-deep/60 mono text-end mt-0.5">
                        14:09 ✓✓
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-paper-50 hairline-t px-3 py-2.5 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-white hairline flex items-center justify-center text-ink-500">
                    <svg
                      viewBox="0 0 16 16"
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M8 3v10M3 8h10" />
                    </svg>
                  </span>
                  <div className="flex-1 bg-white hairline rounded-full px-3 py-2 text-[11px] text-ink-400">
                    Type a message…
                  </div>
                  <button className="w-8 h-8 rounded-full bg-wa-green text-ink-900 flex items-center justify-center shadow-sm hover:scale-105 transition-transform">
                    <svg
                      viewBox="0 0 24 24"
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 2L11 13" />
                      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="absolute -top-3 -right-3 hairline glass rounded-xl px-3 py-2 shadow-md float-y-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex w-2 h-2">
                    <span className="absolute inset-0 rounded-full bg-wa-green pulse-dot"></span>
                    <span className="relative w-2 h-2 rounded-full bg-wa-green"></span>
                  </span>
                  <div className="leading-tight">
                    <div className="text-[11px] font-semibold">3 new messages</div>
                    <div className="mono text-[9px] text-ink-500">just now</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-6 mono text-[10.5px] uppercase tracking-widest text-ink-500 text-center w-full">
              receiver · whatsapp · maya r.
            </div>
          </div>
        </div>

        <LiveStream ctx={ctx} def={def} />
      </div>
    </>
  );
}

export function LiveStream({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <div className="mt-20 hairline rounded-3xl lg:rounded-full bg-white relative overflow-hidden px-6 py-3.5 flex flex-wrap lg:flex-nowrap items-center justify-center lg:justify-start gap-x-5 gap-y-3 shadow-[0_18px_40px_-25px_rgba(50,20,219,0.25)]">
        <div className="flex items-center gap-2 shrink-0">
          <span className="relative flex w-2.5 h-2.5">
            <span className="absolute inset-0 rounded-full bg-wa-green opacity-60 spark-dot"></span>
            <span className="relative w-2.5 h-2.5 rounded-full bg-wa-green pulse-dot"></span>
          </span>
          <T
            ctx={ctx}
            k={k('live_label')}
            as="span"
            className="mono text-[10px] uppercase tracking-[0.22em] text-wa-deep font-semibold"
          />
        </div>

        <div className="w-px h-6 bg-paper-200"></div>

        <div className="w-full lg:w-auto lg:flex-1 relative h-7 overflow-hidden">
          <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-wa-green/30 to-transparent"></div>
          <span className="stream-dot sd1"></span>
          <span className="stream-dot sd2"></span>
          <span className="stream-dot sd3"></span>
          <span className="stream-dot sd4"></span>
          <span className="stream-dot sd5"></span>
          <span className="stream-dot sd6"></span>
          <span className="stream-bub sb1">🌷</span>
          <span className="stream-bub sb2">✓✓</span>
          <span className="stream-bub sb3">📦</span>
        </div>

        <div className="w-px h-6 bg-paper-200"></div>

        <div className="flex flex-wrap items-center justify-center gap-4 shrink-0">
          {[1, 2, 3, 4]
            .filter((i) => has(ctx, def.slug, `live_stat${i}_value`))
            .map((i, idx) => (
              <div key={i} className="contents">
                {idx > 0 && <span className="text-ink-400">·</span>}
                <div className="flex items-baseline gap-1.5">
                  <T
                    ctx={ctx}
                    k={k(`live_stat${i}_value`)}
                    as="span"
                    className={`serif text-[22px] leading-none tabular ${i === 4 ? 'text-wa-deep' : 'text-ink-900'}`}
                  />
                  <T
                    ctx={ctx}
                    k={k(`live_stat${i}_label`)}
                    as="span"
                    className="mono text-[9px] uppercase tracking-widest text-ink-500"
                  />
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}

export function LogoStrip({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="hairline-t hairline-b bg-paper-50">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-7 py-6 flex items-center gap-5 sm:gap-10">
          <T
            ctx={ctx}
            k={k('label')}
            as="div"
            className="mono text-[10px] uppercase tracking-[0.18em] text-ink-500 leading-tight whitespace-nowrap"
          />
          <div className="hairline-l h-12"></div>
          <div className="flex-1 overflow-hidden">
            <div className="marquee whitespace-nowrap text-ink-600">
              {[0, 1].map((copy) => (
                <div
                  key={copy}
                  aria-hidden={copy > 0 ? true : undefined}
                  className="flex items-center gap-12 shrink-0"
                >
                  <T ctx={ctx} k={k('logo1_label')} as="span" className="serif text-[26px]" />
                  <T
                    ctx={ctx}
                    k={k('logo2_label')}
                    as="span"
                    className="text-[20px] font-bold tracking-tight"
                  />
                  <T
                    ctx={ctx}
                    k={k('logo3_label')}
                    as="span"
                    className="serif italic text-[24px]"
                  />
                  <T ctx={ctx} k={k('logo4_label')} as="span" className="text-[18px] mono" />
                  <T
                    ctx={ctx}
                    k={k('logo5_label')}
                    as="span"
                    className="text-[22px] font-bold tracking-wider"
                  />
                  <T ctx={ctx} k={k('logo6_label')} as="span" className="serif text-[26px]" />
                  <T
                    ctx={ctx}
                    k={k('logo7_label')}
                    as="span"
                    className="text-[20px] tracking-[0.3em]"
                  />
                  <T
                    ctx={ctx}
                    k={k('logo8_label')}
                    as="span"
                    className="text-[22px] font-semibold"
                  />
                  <T ctx={ctx} k={k('logo9_label')} as="span" className="serif text-[24px]" />
                  <T ctx={ctx} k={k('logo10_label')} as="span" className="text-[20px] font-bold" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export function Manifesto({ ctx, def }: P) {
  const { k, u, a } = mk(ctx, def.slug);
  void u;
  void a;
  void k;
  return (
    <>
      <section className="max-w-[1360px] mx-auto px-4 sm:px-7 py-28 reveal">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="col-span-12 lg:col-span-3">
            <span className="badge-num" {...a('eyebrow')}>
              — {ctx.fc(k('eyebrow'))}
            </span>

            <T
              ctx={ctx}
              k={k('headline')}
              as="h2"
              className="serif text-[44px] sm:text-[68px] leading-[0.92] tracking-[-0.02em] mt-8 text-ink-900"
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

            <div className="mt-10 hairline-l border-wa-deep/40 ps-4">
              <p className="serif italic text-[16px] leading-snug text-ink-700" {...a('quote')}>
                “{ctx.fc(k('quote'))}”
              </p>
              <div className="mt-4 flex items-center gap-3">
                <T
                  ctx={ctx}
                  k={k('author_initials')}
                  as="span"
                  className="w-9 h-9 rounded-full bg-gradient-to-br from-wa-deep to-wa-teal text-paper-0 text-[11px] font-semibold flex items-center justify-center"
                />
                <div className="leading-tight">
                  <T ctx={ctx} k={k('author')} as="div" className="text-[12.5px] font-semibold" />
                  <T
                    ctx={ctx}
                    k={k('author_role')}
                    as="div"
                    className="mono text-[10px] text-ink-500"
                  />
                </div>
              </div>
            </div>

            <div className="mt-8 mono text-[10px] uppercase tracking-[0.22em] text-ink-500 flex items-center gap-3">
              <T ctx={ctx} k={k('est_label')} as="span" />
              <span className="flex-1 h-px bg-paper-200"></span>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-9">
            <T
              ctx={ctx}
              k={k('body')}
              as="p"
              className="serif text-[28px] sm:text-[44px] leading-[1.18] tracking-[-0.01em] text-ink-900"
            />

            <div className="mt-10 grid grid-cols-3 gap-0 hairline-t hairline-b py-6">
              <div className="hairline-r pe-3 sm:pe-6 min-w-0">
                <T
                  ctx={ctx}
                  k={k('stat1_value')}
                  as="div"
                  className="serif text-[40px] sm:text-[64px] leading-none tabular text-wa-deep"
                />
                <T
                  ctx={ctx}
                  k={k('stat1_label')}
                  as="div"
                  className="mono text-[10px] uppercase tracking-widest text-ink-500 mt-2"
                />
              </div>
              <div className="hairline-r px-3 sm:px-6 min-w-0">
                <T
                  ctx={ctx}
                  k={k('stat2_value')}
                  as="div"
                  className="serif text-[40px] sm:text-[64px] leading-none tabular text-wa-deep"
                />
                <T
                  ctx={ctx}
                  k={k('stat2_label')}
                  as="div"
                  className="mono text-[10px] uppercase tracking-widest text-ink-500 mt-2"
                />
              </div>
              <div className="ps-3 sm:ps-6 min-w-0">
                <T
                  ctx={ctx}
                  k={k('stat3_value')}
                  as="div"
                  className="serif text-[40px] sm:text-[64px] leading-none tabular text-wa-deep"
                />
                <T
                  ctx={ctx}
                  k={k('stat3_label')}
                  as="div"
                  className="mono text-[10px] uppercase tracking-widest text-ink-500 mt-2"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
