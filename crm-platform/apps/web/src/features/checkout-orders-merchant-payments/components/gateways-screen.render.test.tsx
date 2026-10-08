import { describe, expect, it, vi } from 'vitest';
import type { StoreGatewayTestResult } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { CHK_KEYS } from '../api/hooks';
import {
  SHOP_A,
  SHOP_B,
  comingDriver,
  razorpayDriver,
  savedGateway,
  stripeDriver,
} from '../lib/gateway-test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/store/gateways',
  useSearchParams: () => new URLSearchParams(),
}));

import { GatewayCard } from './gateway-card';
import { GatewayDrawer } from './gateway-drawer';
import { GatewayScopePicker } from './gateway-scope-picker';
import { GatewayTestResult } from './gateway-test-result';
import { GatewaysScreen } from './gateways-screen';

const LOCALES = ['en', 'ar'] as const;
const READ = { 'store.gateways.read': 'all' } as const;
const MANAGE = { ...READ, 'store.gateways.manage': 'all' } as const;
const as = (permissions: Record<string, 'all'>) => ({ session: makeSession({ permissions }) });

const PAGE = { nextCursor: null, hasMore: false, limit: 50 };
const DRIVERS = [
  CHK_KEYS.gatewayDrivers,
  { data: [comingDriver, stripeDriver, razorpayDriver], page: PAGE },
] as const;
const ROWS = [CHK_KEYS.gateways, { data: [savedGateway()], page: PAGE }] as const;
const RESOLVED = [
  CHK_KEYS.resolvedGateway(undefined),
  {
    resolved: {
      slug: 'razorpay',
      name: 'Razorpay',
      source: 'workspace_default',
      mode: 'test',
      storefrontId: null,
      id: savedGateway().id,
    },
  },
] as const;
const OVERVIEW = [
  ['store', 'overview', ''],
  { shop: { id: SHOP_A }, shops: [{ id: SHOP_A, shopName: 'Main shop', slug: 'main' }] },
] as const;

function renderScreen(
  locale: 'en' | 'ar',
  permissions: Record<string, 'all'>,
  seed: ReadonlyArray<readonly [readonly unknown[], unknown]>,
) {
  return renderAccount(
    <ToastProvider>
      <GatewaysScreen />
    </ToastProvider>,
    { locale, ...as(permissions), seed },
  );
}

const catalogue = (html: string) => html.slice(html.indexOf('data-testid="gateway-catalogue"'));
const card = (html: string, slug: string) =>
  new RegExp(`data-testid="gateway-${slug}"[\\s\\S]*?</li>`).exec(html)?.[0] ?? '';

describe('Gateways screen', () => {
  it('says one setup serves the checkout and Sales invoices, and what is used now (en)', () => {
    const html = renderScreen('en', MANAGE, [DRIVERS, ROWS, RESOLVED, OVERVIEW]);
    expect(html).toContain('One gateway setup is used by your store checkout and Sales invoices.');
    expect(html).toContain('Currently used: Razorpay (source: workspace default)');
    expect(html).toContain('Workspace (all stores)');
    expect(html).toContain('This store only (override)');
  });

  it('shows the whole catalogue with the saved state of the workspace scope (en)', () => {
    const html = renderScreen('en', MANAGE, [DRIVERS, ROWS, RESOLVED, OVERVIEW]);
    for (const slug of ['razorpay', 'stripe', 'paystack']) {
      expect(html).toContain(`data-testid="gateway-${slug}"`);
    }
    // a saved row first, then the one that can be set up, then the one not available yet
    const order = [...html.matchAll(/data-testid="gateway-(razorpay|stripe|paystack)"/g)].map(
      (m) => m[1],
    );
    expect(order).toEqual(['razorpay', 'stripe', 'paystack']);

    const saved = card(html, 'razorpay');
    expect(saved).toContain('Default');
    expect(saved).toContain('Test');
    expect(saved).toContain('Webhook secret missing');
    expect(saved).toContain('Payment links');
    expect(saved).toContain('Edit');
    expect(saved).toContain('Test connection');
    expect(saved).toContain('Remove');
    // the default row has no "Set as default"
    expect(saved).not.toContain('Set as default');
    expect(saved).toContain('role="switch"');

    const fresh = card(html, 'stripe');
    expect(fresh).toContain('Available');
    expect(fresh).toContain('Configure');
    expect(fresh).not.toContain('Remove');
  });

  it('a gateway that is not available yet is listed but cannot be configured', () => {
    const html = renderScreen('en', MANAGE, [DRIVERS, ROWS, RESOLVED, OVERVIEW]);
    const c = card(html, 'paystack');
    expect(c).toContain('Not available yet');
    expect(c).not.toContain('<button');
  });

  it('offers Set as default on a saved, active row that is not the default', () => {
    const html = renderScreen('en', MANAGE, [
      DRIVERS,
      [CHK_KEYS.gateways, { data: [savedGateway({ isDefault: false })], page: PAGE }],
      RESOLVED,
      OVERVIEW,
    ]);
    expect(card(html, 'razorpay')).toContain('Set as default');
  });

  it('shows the migrated note when the row was copied from the storefront keys', () => {
    const html = renderScreen('en', MANAGE, [
      DRIVERS,
      [CHK_KEYS.gateways, { data: [savedGateway({ migratedFromStorefront: true })], page: PAGE }],
      RESOLVED,
      OVERVIEW,
    ]);
    expect(card(html, 'razorpay')).toContain('Migrated from your storefront keys');
  });

  it('says so when no gateway is set up yet, with a hint', () => {
    const html = renderScreen('en', MANAGE, [
      DRIVERS,
      [CHK_KEYS.gateways, { data: [], page: PAGE }],
      [CHK_KEYS.resolvedGateway(undefined), { resolved: null }],
      OVERVIEW,
    ]);
    expect(html).toContain('No gateway set up yet');
    expect(html).toContain('Until then buyers cannot pay online');
  });

  it('read access shows the catalogue and state but draws no control', () => {
    const html = renderScreen('en', READ, [DRIVERS, ROWS, RESOLVED, OVERVIEW]);
    expect(html).toContain('You can see the gateway setup but not change it');
    const list = catalogue(html);
    expect(list).toContain('Razorpay');
    expect(list).not.toContain('<button');
    expect(list).not.toContain('role="switch"');
  });

  it('without the read permission the page is a no-access panel and loads nothing', () => {
    const html = renderScreen('en', {}, [DRIVERS, ROWS, RESOLVED, OVERVIEW]);
    expect(html).toContain('You do not have access to this page');
    expect(html).not.toContain('data-testid="gateway-catalogue"');
  });

  it('shows loading placeholders until the lists arrive', () => {
    const html = renderScreen('en', MANAGE, []);
    expect(html).toContain('aria-label="Loading gateways"');
    expect(html).not.toContain('data-testid="gateway-catalogue"');
  });

  for (const locale of LOCALES) {
    it(`renders every string of the loaded screen in ${locale}`, () => {
      const html = renderScreen(locale, MANAGE, [DRIVERS, ROWS, RESOLVED, OVERVIEW]);
      expect(html).toContain('data-testid="gateway-razorpay"');
      expect(html).toContain('data-testid="gateway-resolved"');
      if (locale === 'ar') {
        expect(html).toContain('إعداد بوابة واحد');
        expect(html).toContain('بوابات الدفع');
      }
    });
  }
});

describe('GatewayScopePicker', () => {
  for (const locale of LOCALES) {
    it(`offers a shop list with two or more shops (${locale})`, () => {
      const html = renderAccount(
        <GatewayScopePicker
          kind="store"
          onKind={() => undefined}
          onShop={() => undefined}
          shopId={SHOP_B}
          shops={[
            { id: SHOP_A, name: 'Main shop' },
            { id: SHOP_B, name: 'Outlet' },
          ]}
        />,
        { locale },
      );
      expect(html).toContain('<select');
      expect(html).toContain('Main shop');
      expect(html).toContain('Outlet');
    });
  }

  it('shows just the name with one shop, and disables the override without any', () => {
    const one = renderAccount(
      <GatewayScopePicker
        kind="store"
        onKind={() => undefined}
        onShop={() => undefined}
        shopId={SHOP_A}
        shops={[{ id: SHOP_A, name: 'Main shop' }]}
      />,
    );
    expect(one).not.toContain('<select');
    expect(one).toContain('Main shop');

    const none = renderAccount(
      <GatewayScopePicker
        kind="workspace"
        onKind={() => undefined}
        onShop={() => undefined}
        shopId={undefined}
        shops={[]}
      />,
    );
    expect(none).toContain('Create a store first to set up an override.');
    expect(/<input[^>]*value="store"[^>]*>/.exec(none)?.[0]).toContain('disabled=""');
  });
});

describe('GatewayDrawer', () => {
  for (const locale of LOCALES) {
    it(`never echoes a saved secret: it shows the mask as a hint and offers clear (${locale})`, () => {
      const html = renderAccount(
        <ToastProvider>
          <GatewayDrawer
            driver={razorpayDriver}
            saved={savedGateway()}
            storefrontId={undefined}
            scopeText="Workspace"
            onClose={() => undefined}
          />
        </ToastProvider>,
        { locale },
      );
      expect(html).toContain('placeholder="••••••••9z9z"');
      expect(html).toContain('••••••••cdef');
      // no input holds a saved value
      for (const m of html.matchAll(/<input[^>]*type="(?:text|password)"[^>]*>/g)) {
        expect(m[0]).toContain('value=""');
      }
      expect(html).toContain('type="password"');
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('https://api.example.test/v2/store-public/webhooks/gateway/11111111');
      if (locale === 'en') {
        expect(html).toContain('Leave blank to keep the saved value.');
        expect(html).toContain('Clear the saved value');
      }
    });
  }

  it('a new row has no clear box, marks required fields and says the webhook address comes after the first save', () => {
    const html = renderAccount(
      <ToastProvider>
        <GatewayDrawer
          driver={razorpayDriver}
          saved={undefined}
          storefrontId={SHOP_A}
          scopeText="Store: Main shop"
          onClose={() => undefined}
        />
      </ToastProvider>,
    );
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('Key ID');
    expect(html).toContain('Starts with rzp_');
    expect(html).toContain('(required)');
    expect(html).toContain('The webhook address appears here after the first save.');
    expect(html).toContain('Applies to: Store: Main shop');
    expect(html).toContain('Test');
    expect(html).toContain('Live');
  });

  it('draws select and textarea fields from the driver', () => {
    const html = renderAccount(
      <ToastProvider>
        <GatewayDrawer
          driver={{
            ...stripeDriver,
            fields: [
              ...stripeDriver.fields,
              {
                key: 'notes',
                label: 'Notes',
                type: 'textarea',
                required: false,
                hint: null,
                options: null,
                webhook: false,
              },
            ],
          }}
          saved={undefined}
          storefrontId={undefined}
          scopeText="Workspace"
          onClose={() => undefined}
        />
      </ToastProvider>,
    );
    expect(html).toContain('<select');
    expect(html).toContain('<option value="eu">eu</option>');
    expect(html).toContain('<textarea');
  });
});

describe('GatewayTestResult', () => {
  const show = (
    result: Parameters<typeof GatewayTestResult>[0]['result'],
    locale: 'en' | 'ar' = 'en',
  ) =>
    renderAccount(
      <GatewayTestResult result={result} driver={razorpayDriver} onDismiss={() => undefined} />,
      { locale },
    );

  it('verified: the provider accepted the keys', () => {
    const html = show({ ok: true, level: 'verified', message: '', missing: [] });
    expect(html).toContain('data-outcome="verified"');
    expect(html).toContain('The provider accepted the keys.');
  });

  it('fields only: says a payment is the real test', () => {
    const html = show({ ok: true, level: 'fields', message: '', missing: [] });
    expect(html).toContain('data-outcome="fieldsOnly"');
    expect(html).toContain('Only the required fields were checked');
    expect(html).toContain('a payment is the real test');
    expect(html).not.toContain('accepted the keys');
  });

  it('missing: lists the empty fields by label', () => {
    const html = show({
      ok: false,
      level: 'fields',
      message: '',
      missing: ['key_id', 'key_secret'],
    });
    expect(html).toContain('data-outcome="missing"');
    expect(html).toContain('Key ID, Key secret');
  });

  it('rejected: carries what the provider said', () => {
    const html = show({ ok: false, level: 'verified', message: 'Invalid key', missing: [] });
    expect(html).toContain('The provider did not accept the keys.');
    expect(html).toContain('Invalid key');
  });

  const outcomes: StoreGatewayTestResult[] = [
    { ok: true, level: 'verified', message: '', missing: [] },
    { ok: true, level: 'fields', message: '', missing: [] },
    { ok: false, level: 'fields', message: '', missing: ['key_id'] },
    { ok: false, level: 'verified', message: 'x', missing: [] },
  ];
  for (const outcome of outcomes) {
    it(`has Arabic text for ${outcome.level}/${outcome.ok}`, () => {
      expect(show(outcome, 'ar')).toContain('data-testid="gateway-test-result"');
    });
  }
});

describe('GatewayCard permissions', () => {
  it('draws no buttons for a caller who cannot manage', () => {
    const html = renderAccount(
      <ToastProvider>
        <ul>
          <GatewayCard
            driver={razorpayDriver}
            saved={savedGateway()}
            storefrontId={undefined}
            scopeText="Workspace"
            canManage={false}
            onConfigure={() => undefined}
          />
        </ul>
      </ToastProvider>,
    );
    expect(html).not.toContain('<button');
    expect(html).toContain('Webhook secret missing');
  });
});
