import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureAddon } from '@crm/contracts';
import { PlanFeaturesProvider } from '@/lib/plan-features';
import { loadMessages } from '@/i18n/messages';
import { FeatureAddonLock } from './feature-addon-lock';

const perm = vi.hoisted(() => ({ canBuy: true }));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (k: string) => (k === 'paygw.checkout.create' ? perm.canBuy : true),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const addon = (over: Partial<FeatureAddon> = {}): FeatureAddon => ({
  feature: 'inbox_routing',
  addonSlug: 'smart_routing',
  addonName: 'Smart routing',
  offer: 'buy',
  amount: '199.00',
  currency: 'INR',
  billingUnit: 'months',
  billingDuration: 1,
  ...over,
});

function render(
  el: React.ReactElement,
  features: string[] | null,
  featureAddons: FeatureAddon[] | null,
  locale = 'en',
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
      <PlanFeaturesProvider features={features} featureAddons={featureAddons}>
        {el}
      </PlanFeaturesProvider>
    </NextIntlClientProvider>,
  );
}

describe('FeatureAddonLock', () => {
  it('buy: names the add-on with its price and period and links to the add-ons list', () => {
    perm.canBuy = true;
    const out = render(<FeatureAddonLock feature="inbox_routing" />, [], [addon()]);
    expect(out).toContain('data-offer="buy"');
    expect(out).toMatch(/Add Smart routing for ₹199\.00 \/ month/);
    expect(out).toContain('data-testid="feature-addon-lock-buy"');
    expect(out).toContain('href="/account/plans"');
    expect(out).not.toContain('Ask your account owner');
  });

  it('buy, for someone who may not buy: no buy link, asks for the account owner', () => {
    perm.canBuy = false;
    const out = render(<FeatureAddonLock feature="inbox_routing" />, [], [addon()]);
    perm.canBuy = true;
    expect(out).toMatch(/Add Smart routing for/);
    expect(out).toContain('Ask your account owner');
    expect(out).not.toContain('feature-addon-lock-buy');
  });

  it('a period of several units is said in full', () => {
    const out = render(
      <FeatureAddonLock feature="inbox_routing" />,
      [],
      [addon({ billingUnit: 'months', billingDuration: 3, currency: 'USD', amount: '20' })],
    );
    expect(out).toContain('Add Smart routing for $20.00 / 3 months');
  });

  it('unavailable: says the add-on needs an active paid plan and links to the plans', () => {
    const out = render(
      <FeatureAddonLock feature="inbox_routing" />,
      [],
      [addon({ offer: 'unavailable' })],
    );
    expect(out).toContain('data-offer="unavailable"');
    expect(out).toContain('Smart routing needs an active paid plan');
    expect(out).toContain('View plans');
    expect(out).toContain('href="/account/plans"');
  });

  it('hidden: renders nothing at all', () => {
    expect(
      render(<FeatureAddonLock feature="inbox_routing" off />, [], [addon({ offer: 'hidden' })]),
    ).toBe('');
  });

  it('included or owned while the feature is still off: the generic lock with its link', () => {
    for (const offer of ['included', 'owned'] as const) {
      const out = render(<FeatureAddonLock feature="inbox_routing" />, [], [addon({ offer })]);
      expect(out).toContain('data-offer="off"');
      expect(out).toContain('data-testid="addon-lock-link"');
      expect(out).not.toContain('Add Smart routing');
    }
  });

  it('nothing when the feature is on, or when nothing is known (never hide or lock on a guess)', () => {
    expect(
      render(
        <FeatureAddonLock feature="inbox_routing" />,
        ['inbox_routing'],
        [addon({ offer: 'included' })],
      ),
    ).toBe('');
    expect(render(<FeatureAddonLock feature="inbox_routing" />, null, null)).toBe('');
  });

  it('no add-on known but the server says it is locked: the generic lock', () => {
    const out = render(<FeatureAddonLock feature="inbox_routing" off />, null, null);
    expect(out).toContain('data-offer="off"');
    expect(out).toContain('href="/account/plans"');
  });

  it('several keys: an add-on still on sale speaks; only when every one is hidden is there no card', () => {
    const sticky = addon({ feature: 'inbox_assignment_sticky' });
    expect(
      render(
        <FeatureAddonLock feature={['inbox_routing', 'inbox_assignment_sticky']} />,
        [],
        [addon({ offer: 'hidden' }), sticky],
      ),
    ).toContain('data-offer="buy"');
    expect(
      render(
        <FeatureAddonLock feature={['inbox_routing', 'inbox_assignment_sticky']} />,
        [],
        [
          addon({ offer: 'hidden' }),
          addon({ feature: 'inbox_assignment_sticky', offer: 'hidden' }),
        ],
      ),
    ).toBe('');
    expect(
      render(
        <FeatureAddonLock feature={['inbox_routing', 'inbox_assignment_sticky']} />,
        [],
        [addon({ offer: 'unavailable' }), sticky],
      ),
    ).toContain('data-offer="buy"');
  });

  it('reads in Arabic too', () => {
    const out = render(<FeatureAddonLock feature="inbox_routing" />, [], [addon()], 'ar');
    expect(out).toContain('Smart routing');
    expect(out).not.toContain('Add Smart routing for');
  });
});
