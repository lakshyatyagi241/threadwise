import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AddonPack, AddonPlanOffer } from '@crm/contracts';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/admin/addons',
}));

import { renderWithMessages } from '@/features/auth-registration-security/platform/render-test-utils';
import { KEYS } from '../api';
import { PackFormPage } from './pack-form-page';
import { PacksPage } from './packs-page';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const offer = (n: number, over: Partial<AddonPlanOffer> = {}): AddonPlanOffer => ({
  planId: ID(100 + n),
  planSlug: `plan_${n}`,
  planName: `Plan ${n}`,
  planIsActive: true,
  planIsFree: false,
  mode: 'paid',
  amount: null,
  stored: false,
  ...over,
});

const OFFERS = [
  offer(1, { planName: 'Free', planIsFree: true, mode: 'hidden', stored: true }),
  offer(2, { planName: 'Basic', amount: '199.00', stored: true }),
  offer(3, { planName: 'Growth', mode: 'included', stored: true }),
  offer(4, { planName: 'Enterprise', mode: 'included', stored: true }),
  offer(5, { planName: 'Starter' }),
];

const pack = (n: number, over: Partial<AddonPack> = {}): AddonPack => ({
  id: ID(n),
  slug: `pack_${n}`,
  name: `Pack ${n}`,
  subtitle: null,
  detail: null,
  amount: '9.00',
  offerAmount: null,
  currency: 'USD',
  billingUnit: 'months',
  billingDuration: 1,
  billingMode: 'recurring',
  isFree: false,
  isLifetime: false,
  isActive: true,
  sortOrder: 0,
  grants: { features: ['inbox_routing'], limits: {} },
  activePurchases: 0,
  kind: 'feature',
  planOffers: OFFERS,
  rowVersion: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const FIELDS = { features: [], limits: [], currencies: [{ code: 'USD', name: 'US dollar' }] };

describe.each(['en', 'ar'] as const)('admin add-ons list (%s)', (locale) => {
  const html = (packs: AddonPack[]) =>
    renderWithMessages(createElement(PacksPage), {
      locale,
      seed: [
        [KEYS.packs, { data: packs, summary: { total: packs.length, active: packs.length } }],
        [KEYS.fields, FIELDS],
      ],
    });

  it('names each row button after its pack, so a screen reader can tell the rows apart', () => {
    const out = html([pack(1)]);
    // Edit, Disable and Delete: three buttons, each named with the pack's name
    expect(out.match(/aria-label="[^"]*: Pack 1"/g)).toHaveLength(3);
  });

  it('badges each pack Feature or Capacity', () => {
    const out = html([
      pack(1),
      pack(2, { kind: 'capacity', grants: { features: [], limits: { users: 1 } } }),
    ]);
    expect(out).toMatch(new RegExp(`data-testid="pack-kind-${ID(1)}" data-kind="feature"`));
    expect(out).toMatch(new RegExp(`data-testid="pack-kind-${ID(2)}" data-kind="capacity"`));
  });

  it('takes the badge from the stored kind, and warns on a feature add-on that unlocks nothing', () => {
    // grants say capacity-ish (no features) but the operator stored Feature: the badge follows the stored kind
    const out = html([
      pack(1, { grants: { features: [], limits: { users: 2 } } }),
      pack(2, { kind: 'capacity', grants: { features: [], limits: { users: 1 } } }),
      pack(3),
    ]);
    expect(out).toMatch(new RegExp(`data-testid="pack-kind-${ID(1)}" data-kind="feature"`));
    expect(out).toContain(`data-testid="pack-no-features-${ID(1)}"`);
    expect(out).not.toContain(`data-testid="pack-no-features-${ID(2)}"`);
    expect(out).not.toContain(`data-testid="pack-no-features-${ID(3)}"`);
    expect(out).toContain(locale === 'en' ? 'No features yet' : 'لا ميزات بعد');
  });

  it('summarises how every plan offers the pack, in Included, Paid and Hidden chips', () => {
    const out = html([pack(1)]);
    const cell = out.slice(out.indexOf(`data-testid="pack-plans-${ID(1)}"`));
    const chip = (mode: string) => new RegExp(`data-mode="${mode}"[^>]*>([^<]*)<`).exec(cell)?.[1];
    expect(chip('included')).toContain('Growth');
    expect(chip('included')).toContain('Enterprise');
    // a plan price is shown beside its plan; a plan with no row counts as paid at the default price
    expect(chip('paid')).toContain('Basic');
    expect(chip('paid')).toMatch(/199/);
    expect(chip('paid')).toContain('Starter');
    expect(chip('hidden')).toContain('Free');
  });

  it('leaves out an empty mode and says so when no plan exists', () => {
    const out = html([pack(1, { planOffers: [offer(1)] })]);
    const cell = out.slice(out.indexOf(`data-testid="pack-plans-${ID(1)}"`));
    expect(cell).toContain('data-mode="paid"');
    expect(cell.slice(0, cell.indexOf('</td>'))).not.toContain('data-mode="included"');
    const none = html([pack(1, { planOffers: [] })]);
    expect(none).not.toMatch(/data-mode="(included|paid|hidden)"/);
  });
});

describe.each(['en', 'ar'] as const)('pack editor Plans section (%s)', (locale) => {
  const html = (p: AddonPack | null, role?: 'super_admin' | 'support') =>
    renderWithMessages(createElement(PackFormPage, { packId: p?.id }), {
      locale,
      role,
      seed: [...(p ? [[KEYS.pack(p.id), p] as const] : []), [KEYS.fields, FIELDS]],
    });

  it('lists every plan with the segmented control and a price box when paid', () => {
    const out = html(pack(1));
    expect(out).toContain('data-testid="pack-plan-offers"');
    for (const o of OFFERS) expect(out).toContain(`data-testid="pack-plan-${o.planId}"`);
    // one group per plan, plus the type choice at the top
    expect(out.match(/role="radiogroup"/g)).toHaveLength(OFFERS.length + 1);
    expect(out).toContain(`data-testid="pack-plan-${ID(103)}-mode-included"`);
    // paid rows have the price box, with the plan's own price filled in and the add-on's price as placeholder
    expect(out).toContain(`id="pack-plan-${ID(102)}-price"`);
    expect(out).toMatch(new RegExp(`id="pack-plan-${ID(102)}-price"[^>]*value="199.00"`));
    expect(out).toContain('placeholder="9.00"');
    expect(out).not.toContain(`id="pack-plan-${ID(101)}-price"`);
    // nothing changed yet: the save button is off
    expect(out).toMatch(/<button[^>]*disabled[^>]*data-testid="pack-plan-offers-save"/);
  });

  it('a capacity pack has no Included and says why', () => {
    const out = html(pack(1, { kind: 'capacity', grants: { features: [], limits: { users: 1 } } }));
    expect(out).not.toContain('-mode-included"');
    expect(out).toContain(`data-testid="pack-plan-${ID(103)}-mode-paid"`);
    expect(out).toContain(`data-testid="pack-plan-${ID(103)}-mode-hidden"`);
  });

  it('a feature pack with no features disables Included and says why, and shows the notice', () => {
    const out = html(pack(1, { grants: { features: [], limits: { users: 2 } } }));
    expect(out).toContain('data-testid="pack-plan-needs-features"');
    expect(out).toContain('data-testid="no-features-notice"');
    const included =
      out.match(/<input[^>]*data-testid="pack-plan-[^"]*-mode-included"[^>]*>/g) ?? [];
    expect(included).toHaveLength(OFFERS.length);
    for (const r of included) {
      expect(r).toContain('disabled');
      expect(r).toContain('aria-describedby="pack-plan-included-reason"');
    }
    expect(out).toContain(`data-testid="pack-plan-${ID(103)}-mode-paid"`);
    // a pack that unlocks something has neither
    const ok = html(pack(1));
    expect(ok).not.toContain('pack-plan-needs-features');
    expect(ok).not.toContain('no-features-notice');
    expect(ok.match(/<input[^>]*-mode-included"[^>]*>/g)?.some((r) => r.includes('disabled'))).toBe(
      false,
    );
  });

  it('is not shown while creating a pack, and is read-only without edit rights', () => {
    expect(html(null)).not.toContain('data-testid="pack-plan-offers"');
    const ro = html(pack(1), 'support');
    const radios = (ro.match(/<input[^>]*type="radio"[^>]*>/g) ?? []).filter((r) =>
      r.includes('pack-plan-'),
    );
    expect(radios.length).toBeGreaterThan(0);
    for (const r of radios) expect(r).toContain('disabled');
    expect(ro).not.toContain('pack-plan-offers-save');
  });
});

describe.each(['en', 'ar'] as const)('pack editor type and sections (%s)', (locale) => {
  const html = (p: AddonPack | null) =>
    renderWithMessages(createElement(PackFormPage, { packId: p?.id }), {
      locale,
      seed: [...(p ? [[KEYS.pack(p.id), p] as const] : []), [KEYS.fields, FIELDS_FULL]],
    });
  const FIELDS_FULL = {
    features: [{ key: 'inbox_routing', label: 'Smart routing', core: false }],
    limits: [{ key: 'users', label: 'Users' }],
    currencies: [{ code: 'USD', name: 'US dollar' }],
  };

  it('a new pack defaults to Feature: type cards, features and limits shown, no Plans section', () => {
    const out = html(null);
    expect(out).toContain('data-testid="pack-kind"');
    expect(out).toMatch(/data-testid="pack-kind-feature"/);
    expect(out).toMatch(
      /<input[^>]*checked=""[^>]*data-testid="pack-kind-feature"|<input[^>]*data-testid="pack-kind-feature"[^>]*checked=""/,
    );
    expect(out).toContain('id="addon-feature-inbox_routing"');
    expect(out).toContain('id="addon-limit-users"');
    expect(out).not.toContain('data-testid="no-features-notice"');
  });

  it('a capacity add-on shows only the Limit boosts section', () => {
    const out = html(pack(1, { kind: 'capacity', grants: { features: [], limits: { users: 2 } } }));
    expect(out).toMatch(
      /<input[^>]*checked=""[^>]*data-testid="pack-kind-capacity"|<input[^>]*data-testid="pack-kind-capacity"[^>]*checked=""/,
    );
    expect(out).not.toContain('id="addon-feature-inbox_routing"');
    expect(out).toContain('id="addon-limit-users"');
    expect(out).not.toContain('data-testid="no-features-notice"');
  });

  it('a feature add-on with no features shows the notice', () => {
    const out = html(pack(1, { grants: { features: [], limits: { users: 2 } } }));
    expect(out).toContain('data-testid="no-features-notice"');
    expect(out).toContain('id="addon-feature-inbox_routing"');
  });
});
