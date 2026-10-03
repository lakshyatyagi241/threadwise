import Link from 'next/link';
import type { CmsSection } from '@crm/contracts';
import { ContactForm, type ContactLabels } from '../public/contact-form';
import { T, type SiteCtx } from './site-ui';
import { mk, vd } from './tw-common';

interface P {
  ctx: SiteCtx;
  def: CmsSection;
}

/** The three ways to reach the team: email, chat and sales (TW-CMS-005). Addresses come from the company details. */
export function ContactChannels({ ctx, def }: P) {
  const { k, a } = mk(ctx, def.slug);
  const info = ctx.extras.siteInfo;
  const email = info?.emailSupport ?? '';
  const phone = info?.phone ?? '';
  const whatsapp = (info?.whatsapp ?? '').replace(/\D/g, '');
  const labels = (n: 1 | 2 | 3, dark = false) => (
    <ul className={`mt-5 space-y-1.5 pt-4 ${dark ? 'border-t border-paper-0/15' : 'hairline-t'}`}>
      <li className="flex items-center justify-between text-[12px]">
        <T
          ctx={ctx}
          k={k('bestfor_label')}
          as="span"
          className={dark ? 'text-paper-0/75' : 'text-ink-700'}
        />
        <T
          ctx={ctx}
          k={k(`ch${n}_bestfor`)}
          as="span"
          className={`mono text-[10.5px] font-semibold ${dark ? 'text-wa-green' : 'text-wa-deep'}`}
        />
      </li>
      <li className="flex items-center justify-between text-[12px]">
        <T
          ctx={ctx}
          k={k('replytime_label')}
          as="span"
          className={dark ? 'text-paper-0/75' : 'text-ink-700'}
        />
        <T
          ctx={ctx}
          k={k(`ch${n}_replytime`)}
          as="span"
          className={`mono text-[10.5px] font-semibold ${dark ? 'text-wa-green' : 'text-wa-deep'}`}
        />
      </li>
    </ul>
  );
  const cardCls = 'hairline block rounded-3xl bg-paper-50 p-7 transition hover:border-wa-deep';
  return (
    <section className="bg-white" data-section={def.slug} id={def.slug}>
      <div className="mx-auto max-w-[1360px] px-4 py-20 sm:px-7 lg:py-28">
        <div className="mb-12 grid grid-cols-12 gap-8">
          <div className="col-span-12 lg:col-span-2">
            <div className="feature-num text-[88px] sm:text-[120px] lg:text-[140px]">01</div>
          </div>
          <div className="col-span-12 flex flex-col justify-end pb-3 lg:col-span-3">
            <div
              className="mono mb-1 text-[10px] uppercase tracking-[0.22em] text-ink-500"
              {...a('eyebrow')}
            >
              — {ctx.fc(k('eyebrow'))}
            </div>
            <T ctx={ctx} k={k('sublabel')} as="div" className="text-[13px] font-semibold" />
          </div>
          <div className="mono col-span-12 flex flex-wrap items-end justify-start gap-3 pb-3 text-[11px] text-ink-500 lg:col-span-7 lg:justify-end">
            <T ctx={ctx} k={k('caption1')} as="span" />
            <span className="text-ink-300">·</span>
            <T ctx={ctx} k={k('caption2')} as="span" className="text-wa-deep" />
          </div>
        </div>
        <div
          className="reveal grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
          style={vd('120ms')}
        >
          <Link href={email ? `mailto:${email}` : '#contact-form'} className={cardCls}>
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-wa-deep text-paper-0">
              <svg
                viewBox="0 0 24 24"
                className="h-7 w-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 7 9-7" />
              </svg>
            </span>
            <div className="mt-5">
              <T
                ctx={ctx}
                k={k('ch1_label')}
                as="div"
                className="mono text-[10px] uppercase tracking-widest text-ink-500"
              />
              <T
                ctx={ctx}
                k={k('ch1_title')}
                as="div"
                className="serif mt-1 text-[36px] leading-none"
              />
            </div>
            {email && <h3 className="mt-4 text-[15px] font-semibold">{email}</h3>}
            <T
              ctx={ctx}
              k={k('ch1_desc')}
              as="p"
              className="mt-2 text-[12.5px] leading-relaxed text-ink-600"
            />
            {labels(1)}
          </Link>

          <Link
            href={whatsapp ? `https://wa.me/${whatsapp}` : '#contact-form'}
            target={whatsapp ? '_blank' : undefined}
            rel={whatsapp ? 'noopener noreferrer' : undefined}
            className={`${cardCls} relative overflow-hidden`}
          >
            {(ctx.edit || ctx.fc(k('ch2_badge')) !== '') && (
              <div className="absolute right-5 top-5">
                <span className="pill border border-wa-green/40 bg-wa-bubble text-wa-deep">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-wa-green" />
                  <T ctx={ctx} k={k('ch2_badge')} as="span" />
                </span>
              </div>
            )}
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-wa-green text-ink-900">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
                <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
              </svg>
            </span>
            <div className="mt-5">
              <T
                ctx={ctx}
                k={k('ch2_label')}
                as="div"
                className="mono text-[10px] uppercase tracking-widest text-ink-500"
              />
              <T
                ctx={ctx}
                k={k('ch2_title')}
                as="div"
                className="serif mt-1 text-[36px] leading-none"
              />
            </div>
            {phone && <h3 className="mt-4 text-[15px] font-semibold">{phone}</h3>}
            <T
              ctx={ctx}
              k={k('ch2_desc')}
              as="p"
              className="mt-2 text-[12.5px] leading-relaxed text-ink-600"
            />
            {labels(2)}
          </Link>

          <Link
            href="#contact-form"
            className="hairline relative block overflow-hidden rounded-3xl bg-ink-950 p-7 text-paper-0 transition hover:border-wa-green"
          >
            <div className="dot-pattern absolute inset-0 opacity-15" />
            <div className="relative">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-wa-green text-ink-900">
                <svg
                  viewBox="0 0 24 24"
                  className="h-7 w-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
                </svg>
              </span>
              <div className="mt-5">
                <T
                  ctx={ctx}
                  k={k('ch3_label')}
                  as="div"
                  className="mono text-[10px] uppercase tracking-widest text-paper-0/60"
                />
                <T
                  ctx={ctx}
                  k={k('ch3_title')}
                  as="div"
                  className="serif mt-1 text-[36px] leading-none"
                />
              </div>
              <T
                ctx={ctx}
                k={k('ch3_headline')}
                as="h3"
                className="mt-4 text-[15px] font-semibold"
              />
              <T
                ctx={ctx}
                k={k('ch3_desc')}
                as="p"
                className="mt-2 text-[12.5px] leading-relaxed text-paper-0/75"
              />
              {labels(3, true)}
            </div>
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The contact form with the company's office details beside it (TW-CMS-005/006). */
export function ContactFormSection({ ctx, def }: P) {
  const { k, a } = mk(ctx, def.slug);
  const info = ctx.extras.siteInfo;
  const labels = Object.fromEntries(
    [
      'name_label',
      'email_label',
      'company_label',
      'topic_label',
      'message_label',
      'sla',
      'submit_label',
      'success_title',
      'success_text',
      'error_text',
    ].map((f) => [f, ctx.fc(k(f))]),
  ) as unknown as ContactLabels;
  const email = info?.emailGeneral || info?.emailSupport || '';
  const hasOffice =
    !!info && (info.companyName || info.address || info.cityCountry || email || info.phone);
  return (
    <section
      id="contact-form"
      className="hairline-t hairline-b bg-paper-50"
      data-section={def.slug}
    >
      <div className="mx-auto max-w-[1360px] px-4 py-20 sm:px-7 lg:py-28">
        <div className="mb-12 grid grid-cols-12 gap-8">
          <div className="col-span-12 lg:col-span-2">
            <div className="feature-num text-[88px] sm:text-[120px] lg:text-[140px]">02</div>
          </div>
          <div className="col-span-12 flex flex-col justify-end pb-3 lg:col-span-3">
            <div
              className="mono mb-1 text-[10px] uppercase tracking-[0.22em] text-ink-500"
              {...a('eyebrow')}
            >
              — {ctx.fc(k('eyebrow'))}
            </div>
            <T ctx={ctx} k={k('sublabel')} as="div" className="text-[13px] font-semibold" />
          </div>
          <div className="mono col-span-12 flex items-end justify-start gap-3 pb-3 text-[11px] text-ink-500 lg:col-span-7 lg:justify-end">
            <T ctx={ctx} k={k('caption')} as="span" className="text-wa-deep" />
          </div>
        </div>
        <T
          ctx={ctx}
          k={k('headline')}
          as="h2"
          className="serif reveal mb-12 text-[44px] leading-[0.92] tracking-[-0.02em] sm:text-[64px] lg:text-[88px]"
        />
        <div className="reveal grid grid-cols-12 gap-8" style={vd('160ms')}>
          <div className="col-span-12 lg:col-span-7">
            <ContactForm labels={labels} captcha={ctx.extras.captcha ?? null} preview={ctx.edit} />
          </div>
          {hasOffice && info && (
            <div className="col-span-12 lg:col-span-5">
              <div className="hairline rounded-3xl bg-white p-7">
                <div className="mb-3 flex items-center justify-between">
                  <T
                    ctx={ctx}
                    k={k('office_label')}
                    as="div"
                    className="mono text-[10px] uppercase tracking-widest text-ink-500"
                  />
                  <span className="pill bg-wa-green/15 text-[10px] text-wa-deep">HQ</span>
                </div>
                {info.companyName && (
                  <h3 className="serif text-[34px] leading-none">{info.companyName}</h3>
                )}
                {(info.address || info.cityCountry) && (
                  <p className="mt-3 text-[13px] leading-relaxed text-ink-700">
                    {info.address}
                    {info.address && info.cityCountry && <br />}
                    {info.cityCountry}
                  </p>
                )}
                {(email || info.phone) && (
                  <div className="hairline-t mt-5 grid grid-cols-2 gap-4 pt-4 text-[11px]">
                    {email && (
                      <div>
                        <div className="mono text-[9px] uppercase tracking-widest text-ink-500">
                          email
                        </div>
                        <Link
                          href={`mailto:${email}`}
                          className="mt-1 block break-all text-[13px] text-wa-deep"
                        >
                          {email}
                        </Link>
                      </div>
                    )}
                    {info.phone && (
                      <div>
                        <div className="mono text-[9px] uppercase tracking-widest text-ink-500">
                          phone
                        </div>
                        <Link
                          href={`tel:${info.phone.replace(/\s+/g, '')}`}
                          className="mt-1 block text-[13px] text-wa-deep"
                        >
                          {info.phone}
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
