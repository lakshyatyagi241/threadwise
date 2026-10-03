import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import {
  CMS_KEYS,
  CMS_REGISTRY,
  type CmsField,
  type CmsPage,
  type CmsSection,
  type PublicFaqListResponse,
  type PublicPricingResponse,
  type PublicSiteInfo,
} from '@crm/contracts';
import type { CaptchaConfig } from '@/features/auth-registration-security/guest/captcha';
import type { Fc } from './content';
import { ContactForm, type ContactLabels } from '../public/contact-form';
import { UseCases, Testimonials } from './tw-more';
import { FeatureBento, HeroFeatures, PillarsThree, PullQuote } from './tw-features-page';
import {
  FeatureBroadcasts,
  FeatureConnectivity,
  FeatureFlows,
  FeatureInbox,
  FeatureTemplates,
} from './tw-features-home';
import { HeroHome, LogoStrip, Manifesto, TwoDeviceStage } from './tw-home';
import { CtaFinal, FaqSection, FaqSlider, PageHero, PricingSection } from './tw-common';

/** What a page needs next to its own content: data other domains own (plans, FAQs, company details, captcha). */
export interface SiteExtras {
  pricing?: PublicPricingResponse | null;
  /** Pricing FAQs for this page's placement; when there are some they replace the page's own editable Q&A. */
  tableFaqs?: PublicFaqListResponse['data'];
  /** The homepage FAQ marquee. */
  homeFaqs?: PublicFaqListResponse['data'];
  siteInfo?: PublicSiteInfo | null;
  captcha?: CaptchaConfig | null;
  /** The site's brand name and host, for the sample windows of the homepage. */
  brand?: string;
  host?: string;
}

export interface SiteCtx {
  fc: Fc;
  /** The editor preview: every editable element carries `data-fc` so the editor can select and change it. */
  edit: boolean;
  page: CmsPage;
  extras: SiteExtras;
}

const keyOf = (ctx: SiteCtx, slug: string, field: string) => `${ctx.page}.${slug}.${field}`;

type Tag = 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'b' | 'blockquote' | 'small';

/** One editable piece of text. Empty values render nothing for visitors and stay clickable in the editor. */
export function T({
  ctx,
  k,
  as = 'span',
  className,
}: {
  ctx: SiteCtx;
  k: string;
  as?: Tag;
  className?: string;
}) {
  const value = ctx.fc(k);
  if (value === '' && !ctx.edit) return null;
  const Tag = as as unknown as ComponentType<Record<string, unknown>>;
  const type = CMS_KEYS.get(k)?.type ?? 'text';
  const attrs = ctx.edit ? { 'data-fc': k, 'data-fc-type': type } : {};
  return type === 'richtext' ? (
    <Tag className={className} {...attrs} dangerouslySetInnerHTML={{ __html: value }} />
  ) : (
    <Tag className={className} {...attrs}>
      {value}
    </Tag>
  );
}

/** A button or text link built from `<base>_label` and `<base>_url`. */
export function Btn({
  ctx,
  slug,
  base,
  ghost,
}: {
  ctx: SiteCtx;
  slug: string;
  base: string;
  ghost?: boolean;
}) {
  const label = keyOf(ctx, slug, `${base}_label`);
  const url = keyOf(ctx, slug, `${base}_url`);
  const text = ctx.fc(label);
  if (text === '' && !ctx.edit) return null;
  const href = ctx.fc(url) || '#';
  return (
    <Link
      href={href}
      className="cms-btn"
      data-variant={ghost ? 'ghost' : undefined}
      {...(ctx.edit ? { 'data-fc-url': url } : {})}
    >
      <T ctx={ctx} k={label} />
    </Link>
  );
}

// --- generic section ------------------------------------------------------------------------------------------------

const GROUP = /^(.+?)(\d+)_(.+)$/;
const EYEBROWS = new Set(['eyebrow', 'eyebrow_text', 'kicker', 'label', 'sublabel']);
const LEADS = new Set([
  'subtitle',
  'intro',
  'body',
  'para1',
  'para2',
  'caption',
  'caption1',
  'caption2',
  'how_body',
]);

interface Parsed {
  eyebrows: CmsField[];
  headline: CmsField | null;
  leads: CmsField[];
  chips: CmsField[];
  buttons: string[];
  groups: Array<{ name: string; items: Map<number, CmsField[]> }>;
  plain: CmsField[];
}

/**
 * Sorts a section's fields by what they are called, so every editable field is rendered: titles, lead text, chips, button
 * pairs, numbered groups (item1_title, card2_desc, ...) and single values. A new field in the registry shows up on the
 * page without a new renderer.
 */
function parse(def: CmsSection): Parsed {
  const out: Parsed = {
    eyebrows: [],
    headline: null,
    leads: [],
    chips: [],
    buttons: [],
    groups: [],
    plain: [],
  };
  for (const f of def.fields) {
    const k = f.key;
    let m: RegExpExecArray | null;
    if (EYEBROWS.has(k)) out.eyebrows.push(f);
    else if (k === 'headline') out.headline = f;
    else if (/^(meta|chip)\d+$/.test(k) || /^logo\d+_label$/.test(k) || /^backer\d+_name$/.test(k))
      out.chips.push(f);
    else if ((m = /^(cta\d*)_(label|url)$/.exec(k))) {
      if (!out.buttons.includes(m[1]!)) out.buttons.push(m[1]!);
    } else if (LEADS.has(k)) out.leads.push(f);
    else if ((m = GROUP.exec(k)) && !m[1]!.startsWith('faq')) {
      let g = out.groups.find((x) => x.name === m![1]);
      if (!g) {
        g = { name: m[1]!, items: new Map() };
        out.groups.push(g);
      }
      const idx = Number(m[2]);
      g.items.set(idx, [...(g.items.get(idx) ?? []), f]);
    } else out.plain.push(f);
  }
  return out;
}

function Group({
  ctx,
  slug,
  name,
  items,
}: {
  ctx: SiteCtx;
  slug: string;
  name: string;
  items: Map<number, CmsField[]>;
}) {
  const rows = [...items.entries()].sort((a, b) => a[0] - b[0]);
  if (name === 'stat') {
    return (
      <div className="cms-stats">
        {rows.map(([i, fields]) => {
          const value = fields.find((f) => f.key.endsWith('value'));
          const label = fields.find((f) => f.key.endsWith('label'));
          const full = (f: CmsField) => keyOf(ctx, slug, f.key);
          if (!ctx.edit && !fields.some((f) => ctx.fc(full(f)) !== '')) return null;
          return (
            <div key={i} className="cms-stat">
              {value && <T ctx={ctx} k={full(value)} as="b" />}
              {label && <T ctx={ctx} k={full(label)} as="span" className="cms-small" />}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="cms-grid">
      {rows.map(([i, fields]) => {
        const full = (f: CmsField) => keyOf(ctx, slug, f.key);
        if (!ctx.edit && !fields.some((f) => ctx.fc(full(f)) !== '')) return null;
        const first = fields.find((f) => ctx.edit || ctx.fc(full(f)) !== '');
        return (
          <div key={i} className="cms-card">
            {fields.map((f) => {
              const k = full(f);
              if (f === first && f.type === 'text') {
                return <T key={k} ctx={ctx} k={k} as="h3" />;
              }
              if (f.type === 'longtext' && /(^|_)(text|quote)$/.test(f.key)) {
                return <T key={k} ctx={ctx} k={k} as="p" className="cms-quote" />;
              }
              return <T key={k} ctx={ctx} k={k} as="p" className="cms-small" />;
            })}
          </div>
        );
      })}
    </div>
  );
}

export function GenericSection({
  ctx,
  def,
  hero,
  tone,
  children,
}: {
  ctx: SiteCtx;
  def: CmsSection;
  hero?: boolean;
  tone?: 'alt' | 'deep';
  children?: ReactNode;
}) {
  const slug = def.slug;
  const p = parse(def);
  const k = (f: CmsField) => keyOf(ctx, slug, f.key);
  const quote = p.plain.find((f) => f.key === 'quote');
  const author = p.plain.filter((f) => f.key.startsWith('author'));
  const rest = p.plain.filter((f) => f !== quote && !author.includes(f));
  const Wrap = hero ? 'header' : 'section';
  return (
    <Wrap
      className={hero ? 'cms-hero' : 'cms-section'}
      data-tone={tone}
      data-section={slug}
      id={slug}
    >
      <div className="cms-wrap">
        {p.eyebrows.length > 0 && (
          <p className="cms-eyebrow">
            {p.eyebrows.map((f, i) => (
              <span key={f.key}>
                {i > 0 && ctx.fc(k(f)) !== '' ? ' · ' : ''}
                <T ctx={ctx} k={k(f)} />
              </span>
            ))}
          </p>
        )}
        {p.headline && (
          <T
            ctx={ctx}
            k={k(p.headline)}
            as={hero ? 'h1' : 'h2'}
            className={hero ? 'cms-display' : 'cms-h2'}
          />
        )}
        {p.leads.map((f) => (
          <T key={f.key} ctx={ctx} k={k(f)} as="p" className="cms-lead" />
        ))}
        {quote && <T ctx={ctx} k={k(quote)} as="blockquote" className="cms-quote" />}
        {author.length > 0 && (
          <p className="cms-small">
            {author.map((f, i) => (
              <span key={f.key}>
                {i > 0 && ctx.fc(k(f)) !== '' ? ' · ' : ''}
                <T ctx={ctx} k={k(f)} />
              </span>
            ))}
          </p>
        )}
        {rest.map((f) => (
          <T key={f.key} ctx={ctx} k={k(f)} as="p" className="cms-small" />
        ))}
        {p.chips.length > 0 && (
          <div className="cms-chips">
            {p.chips.map((f) => (
              <T key={f.key} ctx={ctx} k={k(f)} className="cms-chip" />
            ))}
          </div>
        )}
        {p.buttons.length > 0 && (
          <div className="cms-btns">
            {p.buttons.map((b, i) => (
              <Btn key={b} ctx={ctx} slug={slug} base={b} ghost={i > 0} />
            ))}
          </div>
        )}
        {p.groups.map((g) => (
          <Group key={g.name} ctx={ctx} slug={slug} name={g.name} items={g.items} />
        ))}
        {children}
      </div>
    </Wrap>
  );
}

// --- specialised sections -------------------------------------------------------------------------------------------

function ChannelsSection({ ctx, def }: { ctx: SiteCtx; def: CmsSection }) {
  const slug = def.slug;
  const info = ctx.extras.siteInfo;
  const hrefs = [
    info?.emailSupport ? `mailto:${info.emailSupport}` : null,
    info?.whatsapp ? `https://wa.me/${info.whatsapp}` : null,
    '#contact-form',
  ];
  const k = (f: string) => keyOf(ctx, slug, f);
  const office =
    info &&
    (info.companyName || info.address || info.cityCountry || info.emailGeneral || info.phone);
  return (
    <section className="cms-section" data-section={slug} id={slug}>
      <div className="cms-wrap">
        <p className="cms-eyebrow">
          <T ctx={ctx} k={k('eyebrow')} />
          {ctx.fc(k('sublabel')) !== '' && ' · '}
          <T ctx={ctx} k={k('sublabel')} />
        </p>
        <T ctx={ctx} k={k('caption1')} as="p" className="cms-lead" />
        <div className="cms-grid">
          {[1, 2, 3].map((i) => {
            const href = hrefs[i - 1];
            return (
              <div key={i} className="cms-card">
                {(ctx.edit || ctx.fc(k(`ch${i}_badge`)) !== '') && (
                  <T ctx={ctx} k={k(`ch${i}_badge`)} className="cms-badge" />
                )}
                <p className="cms-eyebrow" style={{ marginTop: '0.5rem' }}>
                  <T ctx={ctx} k={k(`ch${i}_label`)} />
                </p>
                <T ctx={ctx} k={k(`ch${i}_title`)} as="h3" />
                <T ctx={ctx} k={k(`ch${i}_desc`)} as="p" className="cms-small" />
                <p className="cms-small">
                  <T ctx={ctx} k={k('bestfor_label')} />: <T ctx={ctx} k={k(`ch${i}_bestfor`)} />
                </p>
                <p className="cms-small">
                  <T ctx={ctx} k={k('replytime_label')} />:{' '}
                  <T ctx={ctx} k={k(`ch${i}_replytime`)} />
                </p>
                {href && !ctx.edit && (
                  <p className="cms-small">
                    <a href={href}>
                      {i === 1 ? info?.emailSupport : i === 2 ? (info?.phone ?? '') : ''}
                      {i === 3 ? '↓' : ''}
                    </a>
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {office && (
          <div className="cms-card" style={{ marginTop: '1rem' }}>
            <p className="cms-eyebrow">
              <T ctx={ctx} k={k('office_label')} />
            </p>
            {[info.companyName, info.address, info.cityCountry, info.emailGeneral, info.phone]
              .filter(Boolean)
              .map((line) => (
                <p key={line} className="cms-small" style={{ margin: 0 }}>
                  {line}
                </p>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FormSection({ ctx, def }: { ctx: SiteCtx; def: CmsSection }) {
  const slug = def.slug;
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
    ].map((f) => [f, ctx.fc(keyOf(ctx, slug, f))]),
  ) as unknown as ContactLabels;
  return (
    <section className="cms-section" data-tone="alt" data-section={slug} id="contact-form">
      <div className="cms-wrap">
        <p className="cms-eyebrow">
          <T ctx={ctx} k={keyOf(ctx, slug, 'eyebrow')} />
          {ctx.fc(keyOf(ctx, slug, 'sublabel')) !== '' && ' · '}
          <T ctx={ctx} k={keyOf(ctx, slug, 'sublabel')} />
        </p>
        <T ctx={ctx} k={keyOf(ctx, slug, 'headline')} as="h2" className="cms-h2" />
        <T ctx={ctx} k={keyOf(ctx, slug, 'caption')} as="p" className="cms-lead" />
        <ContactForm labels={labels} captcha={ctx.extras.captcha ?? null} preview={ctx.edit} />
      </div>
    </section>
  );
}

const TONES: Record<string, 'alt' | 'deep' | undefined> = {
  manifesto: 'alt',
  'feature-inbox': 'alt',
  'feature-connectivity': 'alt',
  testimonials: 'alt',
  numbers: 'alt',
  timeline: 'alt',
  'cta-final': 'deep',
};

/** One section of a page, by slug: the specialised ones first, every other section through the generic renderer. */
export function SectionView({ ctx, slug }: { ctx: SiteCtx; slug: string }) {
  const def = CMS_REGISTRY[ctx.page].sections.find((s) => s.slug === slug);
  if (!def) return null;
  switch (slug) {
    case 'hero':
      if (ctx.page === 'home')
        return (
          <HeroHome ctx={ctx} def={def}>
            <TwoDeviceStage ctx={ctx} def={def} />
          </HeroHome>
        );
      if (ctx.page === 'features') return <HeroFeatures ctx={ctx} def={def} />;
      return ctx.page === 'pricing' ? (
        <PageHero ctx={ctx} def={def} />
      ) : (
        <GenericSection ctx={ctx} def={def} hero />
      );
    case 'logo-strip':
      return <LogoStrip ctx={ctx} def={def} />;
    case 'manifesto':
      return <Manifesto ctx={ctx} def={def} />;
    case 'feature-broadcasts':
      return <FeatureBroadcasts ctx={ctx} def={def} />;
    case 'feature-flows':
      return <FeatureFlows ctx={ctx} def={def} />;
    case 'feature-inbox':
      return <FeatureInbox ctx={ctx} def={def} />;
    case 'feature-templates':
      return <FeatureTemplates ctx={ctx} def={def} />;
    case 'feature-connectivity':
      return <FeatureConnectivity ctx={ctx} def={def} />;
    case 'use-cases':
      return <UseCases ctx={ctx} def={def} />;
    case 'testimonials':
      return <Testimonials ctx={ctx} def={def} />;
    case 'feature-bento':
      return <FeatureBento ctx={ctx} def={def} />;
    case 'pillars-three':
      return <PillarsThree ctx={ctx} def={def} />;
    case 'pull-quote':
      return <PullQuote ctx={ctx} def={def} />;
    case 'cta-final':
      return <CtaFinal ctx={ctx} def={def} />;
    case 'faq':
      return <FaqSection ctx={ctx} def={def} />;
    case 'faq-slider':
      return <FaqSlider ctx={ctx} def={def} />;
    case 'pricing-strip':
      return <PricingSection ctx={ctx} def={def} />;
    case 'channels':
      return <ChannelsSection ctx={ctx} def={def} />;
    case 'form':
      return <FormSection ctx={ctx} def={def} />;
    default:
      return <GenericSection ctx={ctx} def={def} tone={TONES[slug]} />;
  }
}
