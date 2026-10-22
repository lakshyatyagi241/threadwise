// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardScreen } from './dashboard-screen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: router.replace }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams('range=7d'),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useSession: () => ({
    permissions: { 'dash.dashboard.read': true },
    roles: [{ name: 'Owner' }],
    org: { timezone: 'UTC' },
    user: { displayName: 'Ada', fullName: 'Ada Lovelace' },
  }),
}));
vi.mock('@/features/persona', () => ({
  usePersonaVisibility: () => ({ isCardHidden: () => false }),
}));
vi.mock('@/lib/use-unofficial-whatsapp', () => ({ useUnofficialWhatsapp: () => false }));
vi.mock('@/features/admin-console-shell/flash/flash-store', () => ({ flash: vi.fn() }));
vi.mock('@/features/admin-console-shell/quick-access/quick-access-tiles', () => ({
  QuickAccessTiles: () => null,
}));
vi.mock('../api/hooks', () => ({
  useSummary: () => ({ data: summary, error: null, isFetching: false, dataUpdatedAt: 0 }),
  useThroughput: () => ({ data: flow, error: null }),
  useWidgets: () => ({ data: undefined }),
}));
vi.mock('./charts', () => ({ BarChart: () => null, Sparkline: () => null, Legend: () => null }));
vi.mock('./funnel', () => ({ Funnel: () => null }));
vi.mock('./dashboard-cards', () => ({
  ActivityCard: () => null,
  CampaignsCard: () => null,
  ContactsCard: () => null,
  DevicesCard: () => null,
  InboxCard: () => null,
  PipelineStrip: () => null,
  TemplatesCard: () => null,
  WalletOrAutopilotCard: () => null,
}));
vi.mock('./dashboard-extras', () => ({
  CopilotCard: () => null,
  FlowsCard: () => null,
  InstagramBand: () => null,
  IntegrationsCard: () => null,
  QuickActionsCard: () => null,
}));

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'dashboards-analytics-charts.json'), 'utf8'),
) as Record<string, unknown>;

const summary = {
  current: {
    sent: 120,
    delivered: 110,
    failed: 10,
    readRate: 50,
    deliverability: 92,
    replies: 8,
    replyRate: 6.7,
  },
  sentDeltaPct: 4,
  readRateDeltaPp: 1,
  sparkline: [1, 2, 3],
  funnel: {},
};
const flow = {
  bucket: 'day',
  timezone: 'UTC',
  starts: ['2026-10-21T00:00:00.000Z'],
  sent: [120],
  delivered: [110],
  failed: [10],
  avgPerHour: 5,
  peak: null,
};

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  router.replace.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = () =>
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DashboardScreen />
      </NextIntlClientProvider>,
    );
  });

describe('the dashboard period', () => {
  it('draws one period filter for the whole page, none inside Message throughput', () => {
    render();
    expect(host.textContent).toContain('Message throughput');
    expect(host.querySelectorAll('select[aria-label="Date range"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role="group"][aria-label="Date range"]')).toHaveLength(0);
  });

  it('changes the period without scrolling the page back to the top', () => {
    render();
    const select = host.querySelector('select[aria-label="Date range"]') as HTMLSelectElement;
    act(() => {
      select.value = '30d';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(router.replace).toHaveBeenCalledWith('/dashboard?range=30d', { scroll: false });
  });
});
