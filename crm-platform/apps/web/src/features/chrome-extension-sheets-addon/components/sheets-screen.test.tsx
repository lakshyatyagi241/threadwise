import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtSheetsOverview } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';

const state = vi.hoisted(() => ({
  query: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    error: null as unknown,
  },
  perms: new Set<string>(['app.google-sheets.use']),
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/sheets', () => ({
  KEYS: { overview: ['ext-sheets', 'overview'] },
  sheetsApi: { generate: vi.fn(), revoke: vi.fn() },
  downloadAddonFile: vi.fn(),
  useOverview: () => ({ ...state.query, refetch: () => undefined }),
}));

import { ApiError } from '@/lib/api/errors';
import { KeyCard, SheetsScreen } from './sheets-screen';

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'chrome-extension-sheets-addon.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const overview = (over: Partial<ExtSheetsOverview> = {}): ExtSheetsOverview => ({
  installed: true,
  blockers: [],
  marketplaceUrl: 'https://workspace.google.com/marketplace/',
  apiBase: 'https://api.example.com',
  key: { active: false, suffix: null, masked: null, createdAt: null, lastUsedAt: null },
  can: { readContacts: true, writeContacts: true, readCatalog: true, writeCatalog: false },
  files: [
    {
      name: 'Code.gs',
      description: 'Server side',
      available: true,
      sizeBytes: 18211,
      contentType: 'text/javascript',
    },
  ],
  shops: [],
  productCount: 0,
  recentProducts: [],
  ...over,
});
const activeKey = {
  active: true,
  suffix: '89abcdef',
  masked: 'wsn_live_••••••••89abcdef',
  createdAt: '2026-10-07T09:30:12.411Z',
  lastUsedAt: null,
};

beforeEach(() => {
  state.perms = new Set(['app.google-sheets.use']);
  state.query = { data: overview(), isPending: false, isError: false, error: null };
});

describe('SheetsScreen', () => {
  it('says so, and loads nothing, when the role lacks the permission', () => {
    state.perms = new Set();
    const out = html(<SheetsScreen />);
    expect(out).toContain('You cannot use the Google Sheets add-on');
    expect(out).not.toContain('Generate key');
  });

  it('shows a spinner while loading', () => {
    state.query = { data: undefined, isPending: true, isError: false, error: null };
    expect(html(<SheetsScreen />)).toContain('Loading the add-on setup');
  });

  it('shows an error with Retry and the request id', () => {
    state.query = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(500, 'INTERNAL', 'boom', 'req-9'),
    };
    const out = html(<SheetsScreen />);
    expect(out).toContain('Could not load the add-on setup.');
    expect(out).toContain('Retry');
    expect(out).toContain('req-9');
  });

  it('not installed: the Marketplace link, no Generate key, no role card', () => {
    state.query.data = overview({ installed: false, blockers: ['not_installed'] });
    const out = html(<SheetsScreen />);
    expect(out).toContain('Install it from the Marketplace');
    expect(out).toContain('href="/marketplace/app/google-sheets"');
    expect(out).toContain('href="https://workspace.google.com/marketplace/"');
    expect(out).not.toContain('Generate key');
    expect(out).not.toContain('What your key can do');
  });

  it('no key yet: Generate key, the role card, six files, the steps and empty shop states', () => {
    const out = html(<SheetsScreen />);
    expect(out).toContain('Generate key');
    expect(out).toContain('You have no key yet.');
    expect(out).toContain('What your key can do');
    for (const name of [
      'Code.gs',
      'Dialog.html',
      'Settings.html',
      'Help.html',
      'appsscript.json',
      'README.md',
    ]) {
      expect(out).toContain(name);
    }
    expect(out).toContain('Not available on this server yet');
    expect(out).toContain('Set it up in a spreadsheet');
    expect(out).toContain('No shops yet');
    expect(out).toContain('No products yet');
  });

  it('active key: the masked key, last used, rotate and revoke, and never a secret', () => {
    state.query.data = overview({ key: activeKey });
    const out = html(<SheetsScreen />);
    expect(out).toContain('wsn_live_••••••••89abcdef');
    expect(out).toContain('Never used');
    expect(out).toContain('Generate a new key');
    expect(out).toContain('Revoke key');
    expect(out).not.toContain('Your new key');
    expect(out).not.toContain('Generate key<');
  });

  it('draws shops and recent products when present', () => {
    state.query.data = overview({
      key: activeKey,
      shops: [
        {
          id: '6f1c0f0a-6f5f-4c55-9a39-b6c1d6a0c001',
          shopName: 'Corner Store',
          slug: 'corner-store',
          currency: 'INR',
          enabled: true,
          themeKey: 'aurora',
          customDomain: null,
          publicUrl: 'https://app.example.com/s/corner-store',
          updatedAt: '2026-10-07T09:12:00.000Z',
        },
      ],
      productCount: 14,
      recentProducts: [
        {
          id: 'a9b2c1d0-1111-4222-8333-444455556666',
          name: 'Blue Tee',
          priceMajor: '499',
          currencyCode: 'USD',
          imageUrl: null,
          createdAt: '2026-10-07T09:12:00.000Z',
        },
      ],
    });
    const out = html(<SheetsScreen />);
    expect(out).toContain('Corner Store');
    expect(out).toContain('https://app.example.com/s/corner-store');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('Blue Tee');
    expect(out).toContain('$499.00');
    expect(out).toContain('14 products in your workspace');
  });

  it('marks the capabilities the role lacks', () => {
    const out = html(<SheetsScreen />);
    expect(out).toContain('Sync products to a shop');
    expect(out).toContain('Not allowed');
  });
});

describe('KeyCard', () => {
  it('labels the buttons and has no secret before a key is generated', () => {
    const out = html(<KeyCard overview={overview()} />);
    expect(out).toContain('<button');
    expect(out).not.toContain('readOnly');
    expect(out).not.toContain('wsn_live_0');
  });
});
