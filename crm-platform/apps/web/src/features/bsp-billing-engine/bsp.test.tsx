import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BspBillingModeResponse, BspDashboard } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { KEYS } from './api';
import { BillingModeCard } from './components/billing-mode-card';
import { DashboardReport } from './components/dashboard-page';
import { ERROR_KINDS } from './lib/errors';
import { formatMoney, formatRange, wabaTail } from './lib/format';
import { settings } from './settings';

const WEB = resolve(__dirname, '../../..');
const raw = JSON.parse(
  readFileSync(join(WEB, 'messages', 'en', 'bsp-billing-engine.json'), 'utf8'),
) as Record<string, unknown>;

type Tree = { [key: string]: string | Tree };
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const en = flatten(raw as Tree);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

describe('messages', () => {
  it('every literal key a component asks for exists', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(join(WEB, 'src', 'features', 'bsp-billing-engine'))) {
      const src = readFileSync(file, 'utf8');
      const decls = [...src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*'([^']+)'\s*\)/g)];
      for (const d of decls) {
        const call = new RegExp(`\\b${d[1]}\\(\\s*'([^']+)'`, 'g');
        for (const c of src.matchAll(call)) {
          if (!(`${d[2]}.${c[1]}` in en)) missing.push(`${file}: ${d[2]}.${c[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('has a message for every error kind and every allocation state', () => {
    for (const k of ERROR_KINDS) expect(en[`bsp-billing-engine.errors.${k}`], k).toBeTruthy();
    for (const s of ['none', 'attached', 'failed', 'revoked'])
      expect(en[`bsp-billing-engine.customer.allocation.${s}`], s).toBeTruthy();
    for (const c of ['workspace', 'messages', 'revenue', 'metaCost', 'margin', 'wallet'])
      expect(en[`bsp-billing-engine.dashboard.columns.${c}`], c).toBeTruthy();
  });
});

describe('formatting', () => {
  it('keeps the digits of a money string and falls back on an unknown currency', () => {
    expect(formatMoney('1234.50', 'USD', 'en')).toBe('$1,234.50');
    expect(formatMoney('0.00', 'ZZZ', 'en')).toContain('0.00');
  });
  it('shortens a WABA id and prints the month window', () => {
    expect(wabaTail('1234567890')).toBe('…567890');
    expect(wabaTail('123')).toBe('123');
    expect(formatRange('2026-10-01T00:00:00.000Z', '2026-10-02T09:00:00.000Z', 'en')).toBe(
      '01 Oct - 02 Oct',
    );
    // the API's `to` is exclusive: a full month ends on its last day, not on the 1st of the next
    expect(formatRange('2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'en')).toBe(
      '01 Oct - 31 Oct',
    );
  });
});

describe('settings tile', () => {
  it('offers one gated tile for the customer billing page', () => {
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({
      section: 'business',
      href: '/billing-mode',
      gates: { permission: 'bsp.billing.read' },
    });
  });
});

const wrap = (el: ReactElement, qc?: QueryClient) =>
  renderToStaticMarkup(
    <QueryClientProvider client={qc ?? new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={raw} timeZone="UTC">
        <ToastProvider>{el}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const dash = (
  over: Partial<BspDashboard['totals']> = {},
  workspaces: BspDashboard['workspaces'] = [],
): BspDashboard => ({
  month: '2026-10',
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-02T09:00:00.000Z',
  currency: 'USD',
  totals: {
    billedMessages: 10,
    freeMessages: 1,
    revenue: '100.00',
    metaCost: '72.00',
    margin: '28.00',
    unpricedMessages: 0,
    walletFloat: '55.25',
    ...over,
  },
  workspaces,
  hasMoreWorkspaces: false,
});

describe('P&L report (TW-BSP-014, -015)', () => {
  it('shows revenue, cost and margin in the base currency, and no banner when every message is priced', () => {
    const html = wrap(<DashboardReport d={dash()} />);
    expect(html).toContain('$100.00');
    expect(html).toContain('$72.00');
    expect(html).toContain('$28.00');
    expect(html).toContain('$55.25');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('No billed messages this month yet.');
  });

  it('warns about messages without a Meta cost', () => {
    const html = wrap(<DashboardReport d={dash({ unpricedMessages: 3 })} />);
    expect(html).toContain('3 billed messages have');
  });

  it('lists each workspace with its margin and balance', () => {
    const html = wrap(
      <DashboardReport
        d={dash({}, [
          {
            workspaceId: '11111111-1111-4111-8111-111111111111',
            workspaceName: 'Acme',
            billedMessages: 7,
            revenue: '90.00',
            metaCost: '60.00',
            margin: '30.00',
            walletBalance: '12.00',
          },
        ])}
      />,
    );
    expect(html).toContain('Acme');
    expect(html).toContain('$30.00');
    expect(html).toContain('$12.00');
    expect(html).not.toContain('No billed messages');
  });
});

const mode = (over: Partial<BspBillingModeResponse> = {}): BspBillingModeResponse => ({
  mode: 'meta_direct',
  resellerAvailable: true,
  accounts: [
    {
      wabaId: '9988776655',
      phone: '+91 98765 43210',
      displayLabel: null,
      allocationStatus: 'attached',
      currency: 'INR',
      lastError: null,
    },
  ],
  ...over,
});
const seeded = (data: BspBillingModeResponse) => {
  const qc = new QueryClient();
  qc.setQueryData(KEYS.billingMode, data);
  return qc;
};

describe('billing mode card (TW-BSP-011)', () => {
  it('marks the active choice and lists the numbers with their credit-line state', () => {
    const html = wrap(<BillingModeCard canManage />, seeded(mode()));
    expect(html).toContain('I pay Meta directly');
    expect(html).toContain('Active');
    expect(html).toContain('+91 98765 43210');
    expect(html).toContain('Credit line attached (INR)');
  });

  it('disables reseller with a badge while the platform credit line is not set up', () => {
    const html = wrap(<BillingModeCard canManage />, seeded(mode({ resellerAvailable: false })));
    expect(html).toContain('Not available yet');
    const reseller = html.slice(html.indexOf('data-testid="mode-reseller"'));
    expect(reseller).toContain('disabled');
  });

  it('is read only for a member who cannot manage billing', () => {
    const html = wrap(<BillingModeCard canManage={false} />, seeded(mode()));
    expect(html).toContain('you cannot change it');
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('says so when no number is connected', () => {
    const html = wrap(<BillingModeCard canManage />, seeded(mode({ accounts: [] })));
    expect(html).toContain('No WhatsApp Business (Cloud API) number is connected yet.');
  });
});
