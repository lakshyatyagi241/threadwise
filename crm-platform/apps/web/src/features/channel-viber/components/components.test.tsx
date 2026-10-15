import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type {
  VibBroadcast,
  VibBroadcastList,
  ViberChannelResponse,
  ViberInsights,
} from '@crm/contracts';

const state = vi.hoisted(() => ({
  can: new Set<string>(),
  channels: { data: undefined as unknown, isLoading: false, isError: false, isSuccess: true },
  broadcasts: { data: undefined as unknown, isLoading: false },
  insights: { data: undefined as unknown, isLoading: false, isError: false },
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (key: string) => state.can.has(key),
}));
vi.mock('../api/viber', () => ({
  KEYS: { all: ['viber'], broadcasts: ['viber', 'broadcasts'] },
  useChannels: () => state.channels,
  useVibBroadcasts: () => state.broadcasts,
  useInsights: () => state.insights,
  connectChannel: vi.fn(),
  retryWebhook: vi.fn(),
  toggleChannel: vi.fn(),
  removeChannel: vi.fn(),
  startBroadcast: vi.fn(),
  pauseBroadcast: vi.fn(),
  retryBroadcast: vi.fn(),
  deleteBroadcast: vi.fn(),
}));

import { BroadcastsScreen } from './broadcasts-screen';
import { HubScreen } from './hub-screen';
import { InsightsScreen } from './insights-screen';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'viber.json'), 'utf8'),
) as Record<string, unknown>;

/** A key a screen asks for that the English file lacks is an error here, not the key's path on screen. */
const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={messages}
        timeZone="UTC"
        onError={(e) => {
          throw e;
        }}
      >
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const channel = (over: Partial<ViberChannelResponse> = {}): ViberChannelResponse => ({
  id: 'c1000000-0000-4000-8000-000000000000',
  viberId: 'acc-1',
  name: 'Acme Shop',
  uri: 'acmeshop',
  avatar: null,
  active: true,
  connectedAt: '2026-10-01T10:00:00.000Z',
  lastInboundAt: null,
  lastError: null,
  webhookUrl: 'https://app.example.com/v2/viber/inbound/abc',
  rowVersion: 1,
  ...over,
});

const broadcast = (over: Partial<VibBroadcast> = {}): VibBroadcast => ({
  id: 'b1000000-0000-4000-8000-000000000000',
  name: 'Weekend sale',
  channelId: 'c1000000-0000-4000-8000-000000000000',
  channelName: 'Acme Shop',
  templateId: null,
  status: 'draft',
  total: 10,
  sent: 0,
  failed: 0,
  delivered: 0,
  seen: 0,
  progress: 0,
  hasMedia: false,
  lastError: null,
  startedAt: null,
  finishedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

const list = (rows: VibBroadcast[]): VibBroadcastList => ({
  data: rows,
  stats: {
    total: rows.length,
    sent: 7,
    failed: 2,
    delivered: 5,
    seen: 3,
    audience: 40,
    sending: 1,
  },
});

beforeEach(() => {
  state.can = new Set([
    'viber.channels.read',
    'viber.channels.manage',
    'viber.broadcasts.read',
    'viber.broadcasts.manage',
  ]);
  state.channels = {
    data: { data: [channel()] },
    isLoading: false,
    isError: false,
    isSuccess: true,
  };
  state.broadcasts = { data: list([]), isLoading: false };
  state.insights = { data: undefined, isLoading: false, isError: false };
});

describe('the Viber hub (TW-VIB-001, 002, 007)', () => {
  it('shows the connect form, the connected channel with its address and its three actions, and the guide', () => {
    const out = html(<HubScreen />);
    expect(out).toContain('Public Account');
    expect(out).toContain('Auth token');
    expect(out).toContain('Connect Viber');
    expect(out).toContain('Acme Shop');
    expect(out).toContain('viber.com/acmeshop');
    expect(out).toContain('https://app.example.com/v2/viber/inbound/abc');
    expect(out).toContain('Re-hook');
    expect(out).toContain('>Pause<');
    expect(out).toContain('Remove');
    expect(out).toContain('Where to get the token');
    expect(out).toContain('Good to know');
    expect(out).toContain('Insights');
    expect(out).toContain('Broadcasts');
  });

  it('a paused channel offers Enable, and an error shows under its name', () => {
    state.channels = {
      data: { data: [channel({ active: false, lastError: '1 invalidUrl' })] },
      isLoading: false,
      isError: false,
      isSuccess: true,
    };
    const out = html(<HubScreen />);
    expect(out).toContain('Paused');
    expect(out).toContain('>Enable<');
    expect(out).toContain('1 invalidUrl');
  });

  it('with no channel it says so, and hides the Insights and Broadcasts buttons', () => {
    state.channels = { data: { data: [] }, isLoading: false, isError: false, isSuccess: true };
    const out = html(<HubScreen />);
    expect(out).toContain('No Viber channels connected yet.');
    expect(out).not.toContain('href="/viber/insights"');
    expect(out).not.toContain('href="/viber/broadcasts"');
  });

  it('someone who may only read sees no connect form and no action buttons, and no Broadcasts link without its permission', () => {
    state.can = new Set(['viber.channels.read']);
    const out = html(<HubScreen />);
    expect(out).toContain('Acme Shop');
    expect(out).not.toContain('Connect Viber');
    expect(out).not.toContain('Re-hook');
    expect(out).not.toContain('>Remove<');
    expect(out).not.toContain('href="/viber/broadcasts"');
    expect(out).toContain('href="/viber/insights"');
  });
});

describe('the Viber broadcasts list (TW-VIB-011, 014)', () => {
  it('the four tiles, and no channel means a way to connect one', () => {
    state.broadcasts = { data: list([]), isLoading: false };
    const out = html(<BroadcastsScreen />);
    for (const label of ['Sent', 'Audience', 'Failed', 'Sending']) expect(out).toContain(label);
    expect(out).toContain('No broadcasts yet.');
    expect(out).toContain('New broadcast');

    state.channels = { data: { data: [] }, isLoading: false, isError: false, isSuccess: true };
    const empty = html(<BroadcastsScreen />);
    expect(empty).toContain('Connect a Viber channel first.');
    expect(empty).not.toContain('New broadcast');
  });

  it('each status has its own button: Start for a draft, Pause while sending, Retry once failed people are left, none when clean', () => {
    state.broadcasts = {
      data: list([
        broadcast({ id: 'a', name: 'Draft one', status: 'draft' }),
        broadcast({ id: 'b', name: 'Going out', status: 'sending', sent: 3, progress: 30 }),
        broadcast({
          id: 'c',
          name: 'Half done',
          status: 'done',
          sent: 8,
          failed: 2,
          progress: 100,
        }),
        broadcast({ id: 'd', name: 'All good', status: 'done', sent: 10, progress: 100 }),
      ]),
      isLoading: false,
    };
    const out = html(<BroadcastsScreen />);
    const row = (name: string) => out.split('<tr').find((r) => r.includes(name)) ?? '';
    expect(row('Draft one')).toContain('>Start<');
    expect(row('Going out')).toContain('>Pause<');
    expect(row('Going out')).not.toContain('>Start<');
    expect(row('Half done')).toContain('>Retry<');
    expect(row('All good')).not.toMatch(/>(Start|Pause|Retry)</);
    expect(row('All good')).toContain('Delete');
  });

  it('shows what was sent and failed, and delivered and seen once Viber reported them', () => {
    state.broadcasts = {
      data: list([
        broadcast({ id: 'a', name: 'Quiet', status: 'done', sent: 4, failed: 1 }),
        broadcast({ id: 'b', name: 'Read', status: 'done', sent: 4, delivered: 3, seen: 2 }),
      ]),
      isLoading: false,
    };
    const out = html(<BroadcastsScreen />);
    const row = (name: string) => out.split('<tr').find((r) => r.includes(name)) ?? '';
    expect(row('Quiet')).toContain('4 sent · 1 failed');
    expect(row('Quiet')).not.toContain('delivered');
    expect(row('Read')).toContain('3 delivered · 2 seen');
  });

  it('a failed broadcast shows why, and someone who may not manage sees no buttons', () => {
    state.broadcasts = {
      data: list([broadcast({ status: 'failed', failed: 3, lastError: '7 tooManyRequests' })]),
      isLoading: false,
    };
    state.can = new Set(['viber.broadcasts.read']);
    const out = html(<BroadcastsScreen />);
    expect(out).toContain('7 tooManyRequests');
    expect(out).not.toMatch(/>(Start|Pause|Retry)</);
    expect(out).not.toContain('New broadcast');
  });
});

describe('the Viber insights (TW-VIB-016)', () => {
  const insights = (over: Partial<ViberInsights> = {}): ViberInsights => ({
    channels: [{ id: 'c1', name: 'Acme Shop' }],
    channelId: 'c1',
    rows: [
      { date: '2026-10-08', in: 4, out: 0 },
      { date: '2026-10-09', in: 2, out: 2 },
    ],
    totals: { in: 6, out: 2, users: 3, delivered: 1, seen: 1, failed: 1 },
    ...over,
  });

  it('the four tiles, the seen and delivered rates, and a bar for each day', () => {
    state.insights = { data: insights(), isLoading: false, isError: false };
    const out = html(<InsightsScreen />);
    expect(out).toContain('Active users (7d)');
    expect(out).toContain('Received (7d)');
    expect(out).toContain('Sent (7d)');
    expect(out).toContain('Failed (7d)');
    expect(out).toContain('50% seen · 50% delivered');
    expect(out).toContain('2026-10-08');
    expect(out).toContain('↓4');
    expect(out).toContain('↑2');
    expect(out).not.toContain('<select');
  });

  it('a channel picker appears only with more than one channel', () => {
    state.insights = {
      data: insights({
        channels: [
          { id: 'c1', name: 'One' },
          { id: 'c2', name: null },
        ],
      }),
      isLoading: false,
      isError: false,
    };
    const out = html(<InsightsScreen />);
    expect(out).toContain('<select');
    expect(out).toContain('One');
    expect(out).toContain('Viber 2');
  });

  it('with no channel it sends you to connect one', () => {
    state.insights = {
      data: insights({
        channels: [],
        channelId: null,
        rows: [],
        totals: { in: 0, out: 0, users: 0, delivered: 0, seen: 0, failed: 0 },
      }),
      isLoading: false,
      isError: false,
    };
    const out = html(<InsightsScreen />);
    expect(out).toContain('Connect a Viber channel first.');
    expect(out).not.toContain('Daily volume');
  });
});
