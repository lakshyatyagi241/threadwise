import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CMS_KEYS, CMS_PAGES, CMS_REGISTRY, type PublicPricingResponse } from '@crm/contracts';
import { makeFc } from './content';
import { SectionView, type SiteCtx } from './site-ui';

type Tree = { [k: string]: string | Tree };
const merge = (a: Tree, b: Tree): Tree => {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] =
      typeof v === 'object' && typeof out[k] === 'object' ? merge(out[k] as Tree, v as Tree) : v;
  return out;
};
const messages = readdirSync(join(process.cwd(), 'messages', 'en'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(process.cwd(), 'messages', 'en', f), 'utf8')) as Tree)
  .reduce((acc, m) => merge(acc, m), {});

const pricing = {
  yearlyToggle: true,
  yearlyDiscountPct: 20,
  plans: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      slug: 'starter',
      name: 'Starter',
      subtitle: 'Free to begin',
      kind: 'free',
      price: { amount: '0.00', offerAmount: null, currency: 'USD', period: null },
      lifetime: false,
      monthlyMessages: 0,
      chips: [],
      highlighted: false,
      ctaLabel: '',
      limits: {},
      features: {},
      yearlyAmount: null,
      ctaUrl: '/register',
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      slug: 'growth',
      name: 'Growth',
      subtitle: 'For teams',
      kind: 'paid',
      price: {
        amount: '20.00',
        offerAmount: null,
        currency: 'USD',
        period: { unit: 'months', count: 1 },
      },
      lifetime: false,
      monthlyMessages: 1000,
      chips: [],
      highlighted: true,
      ctaLabel: 'Get going',
      limits: { devices: 3, monthly_messages: 0 },
      features: { automation: true },
      yearlyAmount: '192.00',
      ctaUrl: '/checkout/growth',
    },
  ],
} as unknown as PublicPricingResponse;

/** Renders every section of every page with a recording `fc`, so the page and the registry cannot drift apart. */
function renderAll(content: Record<string, string> = {}, plans: PublicPricingResponse = pricing) {
  const read = new Set<string>();
  const unknown = new Set<string>();
  const base = makeFc(content);
  for (const page of CMS_PAGES) {
    const ctx: SiteCtx = {
      page,
      edit: false,
      extras: {
        pricing: plans,
        tableFaqs: [],
        homeFaqs: [{ id: 'f1', question: 'Q?', answer: 'A.' }] as never,
        siteInfo: {
          companyName: 'Acme',
          address: '1 Main St',
          cityCountry: 'Town',
          emailGeneral: 'hi@acme.test',
          emailSupport: 'help@acme.test',
          phone: '+1 555 0100',
          whatsapp: '15550100',
        },
        brand: 'Acme',
        host: 'acme.test',
      },
      fc: (key) => {
        read.add(key);
        if (!CMS_KEYS.has(key)) unknown.add(key);
        return base(key);
      },
    };
    for (const section of CMS_REGISTRY[page].sections) {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={new QueryClient()}>
          <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
            <SectionView ctx={ctx} slug={section.slug} />
          </NextIntlClientProvider>
        </QueryClientProvider>,
      );
      expect(html, `${page}.${section.slug} renders`).not.toBe('');
    }
  }
  return { read, unknown };
}

/** Every page field given a value, so a field that only shows when it has text is read too. */
const filled = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const page of CMS_PAGES)
    for (const section of CMS_REGISTRY[page].sections)
      for (const field of section.fields)
        out[`${page}.${section.slug}.${field.key}`] = field.type === 'link' ? '/x' : 'text';
  return out;
};

describe('the public pages and the page registry (WD-CMS-009)', () => {
  const a = renderAll();
  const b = renderAll(filled());
  // with no active plan the fallback cards are what the strip shows
  const c = renderAll(filled(), { plans: [], yearlyToggle: false, yearlyDiscountPct: 0 });
  const read = new Set([...a.read, ...b.read, ...c.read]);
  const unknown = new Set([...a.unknown, ...b.unknown, ...c.unknown]);

  it('every section of every page renders, and only reads keys the registry declares', () => {
    expect([...unknown]).toEqual([]);
  });

  it('every editable field of every page section is shown somewhere on its page', () => {
    // The ticker, navigation and footer live in the frame, not in a page section, so they are not part of this check.
    const notRead: string[] = [];
    for (const page of CMS_PAGES) {
      for (const section of CMS_REGISTRY[page].sections) {
        for (const field of section.fields) {
          const key = `${page}.${section.slug}.${field.key}`;
          if (!read.has(key)) notRead.push(key);
        }
      }
    }
    expect(notRead).toEqual([]);
  });
});

describe('the plan cards of the pricing page (WD-CMS-003)', () => {
  it('shows the catalogue plans in the editorial layout, with the yearly switch preselected', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
          <SectionView
            ctx={{
              page: 'pricing',
              edit: false,
              fc: makeFc({}),
              extras: { pricing },
            }}
            slug="pricing-strip"
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(html).toContain('data-testid="site-plan-starter"');
    expect(html).toContain('data-testid="site-plan-growth"');
    expect(html).toContain('Plan · 01');
    expect(html).toContain('Plan · 02');
    // yearly is selected first (WaDesk): the yearly monthly equivalent of 192/12
    expect(html).toContain('$16.00');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('/checkout/growth?period=yearly');
  });

  it('falls back to the three editable tiers when no plan is active', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
          <SectionView
            ctx={{
              page: 'pricing',
              edit: false,
              fc: makeFc({ 'pricing.pricing-strip.tier1_name': 'Basic' }),
              extras: { pricing: { plans: [], yearlyToggle: false, yearlyDiscountPct: 0 } },
            }}
            slug="pricing-strip"
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(html).toContain('Basic');
    expect(html).toContain('data-testid="site-plan-fallback-1"');
    expect(html).not.toContain('aria-checked');
  });
});
