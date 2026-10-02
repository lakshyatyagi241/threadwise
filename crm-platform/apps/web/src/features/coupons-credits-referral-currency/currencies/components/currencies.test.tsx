import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CurrencyItem, WorkspaceCurrencyResponse } from '@crm/contracts';
import {
  AddCurrencyForm,
  CurrencyKpis,
  CurrencyTable,
  DefaultCurrencyCard,
  EditCurrencyForm,
} from './currency-parts';
import { WorkspaceCurrencyForm } from './workspace-currency-page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/',
}));

const raw = JSON.parse(
  readFileSync(
    join(
      resolve(__dirname, '../../../../..'),
      'messages',
      'en',
      'coupons-credits-referral-currency.currencies.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

const wrap = (el: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={raw} timeZone="UTC">
        {el}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const row = (n: number, over: Partial<CurrencyItem> = {}): CurrencyItem => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: 'Name ' + n,
  code: 'C' + n + 'X',
  symbol: '$',
  precision: 2,
  exchangeRate: '1.000000',
  isActive: true,
  isDefault: false,
  rowVersion: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const USD = row(1, { code: 'USD', name: 'US Dollar', isDefault: true });
const INR = row(2, { code: 'INR', name: 'Indian Rupee', symbol: '₹', exchangeRate: '83.25' });
const OFF = row(3, { code: 'CHF', name: 'Swiss Franc', isActive: false });

const noop = () => undefined;
const table = (
  rows: CurrencyItem[],
  canWrite: boolean,
  extra: { q?: string; editingId?: string | null } = {},
) =>
  wrap(
    <CurrencyTable
      rows={rows}
      q={extra.q ?? ''}
      canWrite={canWrite}
      busyId={null}
      editingId={extra.editingId ?? null}
      renderEditor={(i) => (
        <EditCurrencyForm
          item={i}
          busy={false}
          problems={{}}
          stale={false}
          onSubmit={noop}
          onCancel={noop}
        />
      )}
      onToggle={noop}
      onEdit={noop}
      onDelete={noop}
    />,
  );

describe('TW-CPN-018 admin catalog', () => {
  it('AC1: the KPI cards read Total / Active / default code in capitals / Inactive', () => {
    const html = wrap(
      <CurrencyKpis stats={{ total: 30, active: 30, inactive: 0, defaultCode: 'usd' }} />,
    );
    for (const label of ['Total', 'Active', 'System default', 'Inactive'])
      expect(html).toContain(label);
    expect(html).toContain('>30<');
    expect(html).toContain('class="uppercase">usd<');
    expect(html).toContain('>0<');
  });

  it('AC1: the default row carries the Default badge and the rate shows 4 decimals as "1 USD ->" column', () => {
    const html = table([USD, INR], true);
    expect(html).toContain('Rate (1 USD →)');
    expect(html).toContain('83.2500');
    expect(html.match(/>Default</g)).toHaveLength(1);
    expect(html.indexOf('>Default<')).toBeGreaterThan(html.indexOf('USD'));
    expect(html.indexOf('>Default<')).toBeLessThan(html.indexOf('INR'));
  });

  it('shows the columns Code, Name, Symbol, Rate, Decimals, Active', () => {
    const html = table([USD], true);
    for (const c of ['Code', 'Name', 'Symbol', 'Decimals', 'Active'])
      expect(html).toContain(`>${c}<`);
  });

  it('AC3 / TW-CPN-022: no Delete button on the default row, Delete on the others', () => {
    const html = table([USD, INR], true);
    expect(html).not.toContain('aria-label="Delete: USD"');
    expect(html).toContain('aria-label="Delete: INR"');
  });

  it('empty states: a search with no match and an empty catalog', () => {
    expect(table([], true, { q: 'zzz' })).toContain('No matches for &quot;zzz&quot;.');
    expect(table([], true)).toContain('No currencies yet.');
  });

  it('a read-only operator sees no On/Off button, Edit or Delete, but still the state', () => {
    const html = table([USD, INR, OFF], false);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Edit');
    expect(html).toContain('>On<');
    expect(html).toContain('>Off<');
  });
});

describe('TW-CPN-021 On/Off pill', () => {
  it('is a button per row with the current state, named for what it will do', () => {
    const html = table([INR, OFF], true);
    expect(html).toContain('aria-label="Switch INR off"');
    expect(html).toContain('aria-label="Switch CHF on"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });
});

describe('TW-CPN-020 inline edit', () => {
  it('opens under the row with the code read-only and the fields filled', () => {
    const html = table([INR], true, { editingId: INR.id });
    expect(html).toContain('Edit INR');
    expect(html).toContain('The code cannot be changed once a currency is saved.');
    expect(html).toMatch(/<input[^>]*id="cur-edit-[^"]*-code"[^>]*readOnly=""/);
    expect(html).toContain('value="Indian Rupee"');
    expect(html).toContain('value="83.25"');
    expect(html).toContain('>Save<');
  });

  it('says so when the row changed under the editor', () => {
    const html = wrap(
      <EditCurrencyForm
        item={INR}
        busy={false}
        problems={{}}
        stale
        onSubmit={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('Someone else changed this currency.');
  });
});

describe('TW-CPN-019 add form', () => {
  const html = wrap(<AddCurrencyForm busy={false} problems={{}} onSubmit={noop} onCancel={noop} />);

  it('has the Reference fields with their limits and defaults', () => {
    for (const l of [
      'Name *',
      'ISO code *',
      'Symbol',
      'Decimals *',
      'Exchange rate (1 USD = ?) *',
    ]) {
      expect(html).toContain(l);
    }
    expect(html).toContain('maxLength="120"');
    expect(html).toContain('maxLength="10"');
    expect(html).toContain('maxLength="20"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="6"');
    expect(html).toContain('step="0.000001"');
    expect(html).toContain('min="0.000001"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="1"');
  });

  it('styles the code in capitals and starts with "Active immediately" checked', () => {
    expect(html).toMatch(/<input[^>]*class="[^"]*uppercase[^"]*"[^>]*/);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(html).toContain('Active immediately');
    expect(html).toContain('>Add currency<');
    expect(html).toContain('>Cancel<');
  });

  it('flags a refused field with its message, and a duplicate code with its own', () => {
    const bad = wrap(
      <AddCurrencyForm
        busy={false}
        problems={{ exchangeRate: true, code: true, codeTaken: true }}
        onSubmit={noop}
        onCancel={noop}
      />,
    );
    expect(bad).toContain('Enter a rate of at least 0.000001');
    expect(bad).toContain('This code is already in the catalog.');
    expect(bad).toContain('aria-invalid="true"');
  });
});

describe('TW-CPN-024 default selector', () => {
  const options = [
    { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
    { code: 'USD', name: 'US Dollar', symbol: '$' },
  ];
  it('lists the active options as "CODE - name (symbol)" with the current default preselected', () => {
    const html = wrap(
      <DefaultCurrencyCard
        options={options}
        defaultCode="USD"
        canWrite
        busy={false}
        onSet={noop}
      />,
    );
    expect(html).toContain('INR - Indian Rupee (₹)');
    expect(html).toMatch(/<option value="USD" selected=""[^>]*>USD - US Dollar \(\$\)/);
    expect(html).toContain('>Set default<');
    expect(html).toContain('Platform-wide currency fallback');
  });

  it('is read-only for an operator who cannot write: the select is disabled and there is no button', () => {
    const html = wrap(
      <DefaultCurrencyCard
        options={options}
        defaultCode="USD"
        canWrite={false}
        busy={false}
        onSet={noop}
      />,
    );
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).not.toContain('Set default');
  });
});

describe('TW-CPN-027 workspace currency select', () => {
  const data: WorkspaceCurrencyResponse = {
    currency: null,
    effective: 'USD',
    platformDefault: 'USD',
    options: [
      { code: 'EUR', name: 'Euro', symbol: '€' },
      { code: 'USD', name: 'US Dollar', symbol: '$' },
    ],
  };

  it('owner: a first "Platform default (XXX)" option, the active currencies, the helper text, Save', () => {
    const html = wrap(<WorkspaceCurrencyForm data={data} isOwner />);
    expect(html).toContain('Currency');
    expect(html).toContain('Used on plan checkout, invoices, and wallet display');
    const first = html.indexOf('<option');
    expect(html.slice(first, first + 80)).toContain('Platform default (USD)');
    expect(html).toContain('EUR - Euro (€)');
    expect(html).not.toMatch(/<select[^>]*disabled/);
    expect(html).not.toContain('Only the workspace owner can edit these.');
    expect(html).toContain('>Save<');
  });

  it("shows the workspace's own currency selected", () => {
    const html = wrap(
      <WorkspaceCurrencyForm data={{ ...data, currency: 'EUR', effective: 'EUR' }} isOwner />,
    );
    expect(html).toMatch(/<option value="EUR" selected=""/);
    expect(html).toContain('Currently showing amounts in EUR.');
  });

  it('non-owner: the select and Save are disabled and the owner-only note shows (no submit possible)', () => {
    const html = wrap(<WorkspaceCurrencyForm data={data} isOwner={false} />);
    expect(html).toContain('Only the workspace owner can edit these.');
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/,
    );
  });
});
