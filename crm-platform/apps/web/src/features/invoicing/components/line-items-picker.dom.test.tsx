// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SalesItem, SessionResponse, TaxRateResponse } from '@crm/contracts';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { loadMessages } from '@/i18n/messages';
import { PlanFeaturesProvider } from '@/lib/plan-features';
import { emptyLine, type DraftLine } from '../lib/builder';
import { InvoiceLinesEditor } from './line-items-editor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/features/products-services/api/service', () => ({ productsApi: api }));

const item = (over: Partial<SalesItem>): SalesItem => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'service',
  name: 'Consulting',
  sku: 'C-1',
  description: null,
  unit: 'hour',
  unitPriceMinor: 125050,
  currency: 'INR',
  taxRatePercent: 18,
  isActive: true,
  createdAt: '2026-10-27T00:00:00.000Z',
  updatedAt: '2026-10-27T00:00:00.000Z',
  rowVersion: 1,
  ...over,
});
const rates = [
  { id: 'r5', name: 'GST', rate: '5', inclusive: false, isActive: true, isDefault: false },
  { id: 'r18', name: 'GST', rate: '18', inclusive: false, isActive: true, isDefault: true },
] as unknown as TaxRateResponse[];

let root: Root | undefined;
let latest: DraftLine[] = [];
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  api.list.mockReset();
});

function Harness() {
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  return (
    <InvoiceLinesEditor
      lines={lines}
      onChange={(next) => {
        latest = next;
        setLines(next);
      }}
      currency="INR"
      taxRates={rates}
      showHsn={false}
    />
  );
}

async function mount(opts: { feature: boolean; perm: boolean; session?: boolean }) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const session = {
    permissions: opts.perm ? { 'record.sales-items.read': 'all' } : {},
  } as unknown as SessionResponse;
  const features = opts.feature ? ['products_services'] : ['forms'];
  let ui = <Harness />;
  if (opts.session !== false) {
    ui = (
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider session={session}>
          <PlanFeaturesProvider features={features}>{ui}</PlanFeaturesProvider>
        </SessionProvider>
      </QueryClientProvider>
    );
  }
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        {ui}
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

const picker = () =>
  document.querySelector(
    'select[aria-label="Pick from your price list"]',
  ) as HTMLSelectElement | null;

describe('the price-list picker on a document line', () => {
  const data = {
    data: [
      item({}),
      item({ id: '22222222-2222-4222-8222-222222222222', name: 'Dollar job', currency: 'USD' }),
    ],
    total: 2,
    page: 1,
    limit: 200,
    counts: { all: 2, active: 2, inactive: 0 },
  };

  it('is absent when the add-on is off, without the permission, or without a session', async () => {
    api.list.mockResolvedValue(data);
    await mount({ feature: false, perm: true });
    expect(picker()).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
    act(() => root?.unmount());
    document.body.innerHTML = '';
    await mount({ feature: true, perm: false });
    expect(picker()).toBeNull();
    act(() => root?.unmount());
    document.body.innerHTML = '';
    await mount({ feature: true, perm: true, session: false });
    expect(picker()).toBeNull();
    expect(document.querySelector('textarea')).not.toBeNull();
  });

  it('fills the line from the item, keeps it editable, and refuses another currency', async () => {
    api.list.mockResolvedValue(data);
    await mount({ feature: true, perm: true });
    const select = picker()!;
    const options = [...select.options];
    expect(options.find((o) => o.textContent?.includes('Dollar job'))!.disabled).toBe(true);
    await act(async () => {
      select.value = '11111111-1111-4111-8111-111111111111';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(latest[0]).toMatchObject({
      description: 'Consulting',
      sku: 'C-1',
      price: '1250.50',
      taxRateId: 'r18',
    });
  });

  it('stays out of the way when the list is empty or fails', async () => {
    api.list.mockResolvedValue({ ...data, data: [], total: 0 });
    await mount({ feature: true, perm: true });
    expect(picker()).toBeNull();
    act(() => root?.unmount());
    document.body.innerHTML = '';
    api.list.mockRejectedValue(new Error('locked'));
    await mount({ feature: true, perm: true });
    expect(picker()).toBeNull();
    expect(document.querySelector('textarea')).not.toBeNull();
  });
});
