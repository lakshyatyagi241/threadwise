import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENT, type WalletSummary } from '@crm/contracts';
import { fakeSocketFactory } from '@/lib/realtime/fake-socket';
import { RealtimeClient } from '@/lib/realtime/realtime-client';
import { KEYS } from './api';
import { WalletBalanceChip } from './components/customer/wallet-balance-chip';
import {
  BALANCE_REFRESH_MS,
  applyWalletUpdate,
  subscribeWalletUpdates,
} from './components/customer/use-wallet-balance';

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));

const raw = JSON.parse(
  readFileSync(
    join(resolve(__dirname, '../../..'), 'messages', 'en', 'wallet-message-billing.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const summary = (over: Partial<WalletSummary> = {}): WalletSummary => ({
  currency: 'USD',
  balanceMinor: 10_000,
  billingMode: 'wallet',
  perCountryEnabled: false,
  flatPriceMinor: 50,
  approxMessages: 200,
  spent30dMinor: 0,
  earned30dMinor: 0,
  toppedUp30dMinor: 0,
  refunded30dMinor: 0,
  lowBalanceThresholdMinor: 500,
  lowBalance: false,
  plan: { monthlyMessagesLimit: 0, usedThisMonth: 0, active: true, endsAt: null },
  topupUrl: '/billing/checkout/wallet',
  ...over,
});

const chip = (qc: QueryClient) =>
  renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={raw} timeZone="UTC">
        <WalletBalanceChip />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

let tickets = 0;
async function connected() {
  const { factory, last } = fakeSocketFactory();
  const client = new RealtimeClient({
    url: 'http://api.test/realtime',
    mintTicket: async () => `rtk_${++tickets}`,
    createSocket: factory,
  });
  client.start();
  await vi.advanceTimersByTimeAsync(0);
  last().accept();
  last().serverEmit('rt.ready', {
    v: 1,
    rooms: [
      { room: 'org', seq: 0 },
      { room: 'user', seq: 0 },
    ],
    serverTime: new Date(0).toISOString(),
  });
  return { client, socket: last };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('wallet balance realtime', () => {
  it('shows the new balance on the chip as soon as wallet.updated arrives, then refetches the summary', async () => {
    const qc = new QueryClient();
    qc.setQueryData(KEYS.summary, summary());
    expect(chip(qc)).toContain('$100.00');

    const { client, socket } = await connected();
    subscribeWalletUpdates(client, qc);
    socket().push({
      type: REALTIME_EVENT.walletUpdated,
      room: 'org',
      seq: 1,
      payload: { balanceMinor: 7_525, reason: 'charge' },
    });

    expect(qc.getQueryData<WalletSummary>(KEYS.summary)?.balanceMinor).toBe(7_525);
    expect(chip(qc)).toContain('$75.25');
    expect(qc.getQueryState(KEYS.summary)?.isInvalidated).toBe(true);
  });

  it('recomputes the low-balance flag and the message estimate from the pushed balance', () => {
    const qc = new QueryClient();
    qc.setQueryData(KEYS.summary, summary());
    applyWalletUpdate(qc, { balanceMinor: 400, reason: 'charge' });
    expect(qc.getQueryData<WalletSummary>(KEYS.summary)).toMatchObject({
      balanceMinor: 400,
      lowBalance: true,
      approxMessages: 8,
    });
    expect(chip(qc)).toContain('$4.00');
    applyWalletUpdate(qc, { balanceMinor: 50_000, reason: 'topup' });
    expect(qc.getQueryData<WalletSummary>(KEYS.summary)).toMatchObject({
      lowBalance: false,
      approxMessages: 1000,
    });
  });

  it('leaves the estimate empty under per-country pricing and does not invent a summary that was never loaded', () => {
    const qc = new QueryClient();
    qc.setQueryData(KEYS.summary, summary({ approxMessages: null, perCountryEnabled: true }));
    applyWalletUpdate(qc, { balanceMinor: 900, reason: 'refund' });
    expect(qc.getQueryData<WalletSummary>(KEYS.summary)?.approxMessages).toBeNull();

    const empty = new QueryClient();
    applyWalletUpdate(empty, { balanceMinor: 900, reason: 'refund' });
    expect(empty.getQueryData(KEYS.summary)).toBeUndefined();
  });

  it('refetches rather than trusting a payload that does not match the contract', async () => {
    const qc = new QueryClient();
    qc.setQueryData(KEYS.summary, summary());
    const { client, socket } = await connected();
    subscribeWalletUpdates(client, qc);
    socket().push({
      type: REALTIME_EVENT.walletUpdated,
      room: 'org',
      seq: 1,
      payload: { balanceMinor: 'lots' },
    });
    expect(qc.getQueryData<WalletSummary>(KEYS.summary)?.balanceMinor).toBe(10_000);
    expect(qc.getQueryState(KEYS.summary)?.isInvalidated).toBe(true);
  });

  it('refetches after a sequence gap or reconnect on the workspace room, and ignores other rooms', async () => {
    const qc = new QueryClient();
    qc.setQueryData(KEYS.summary, summary());
    const { client, socket } = await connected();
    subscribeWalletUpdates(client, qc);

    // a skipped number on the user room is not this screen's business
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 1 });
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 5 });
    expect(qc.getQueryState(KEYS.summary)?.isInvalidated).toBe(false);

    socket().push({ type: REALTIME_EVENT.presence, room: 'org', seq: 1 });
    socket().push({ type: REALTIME_EVENT.presence, room: 'org', seq: 4 });
    expect(qc.getQueryState(KEYS.summary)?.isInvalidated).toBe(true);
  });

  it('stops following events after unsubscribe', async () => {
    const qc = new QueryClient();
    qc.setQueryData(KEYS.summary, summary());
    const { client, socket } = await connected();
    const off = subscribeWalletUpdates(client, qc);
    off();
    socket().push({
      type: REALTIME_EVENT.walletUpdated,
      room: 'org',
      seq: 1,
      payload: { balanceMinor: 1, reason: 'charge' },
    });
    expect(qc.getQueryData<WalletSummary>(KEYS.summary)?.balanceMinor).toBe(10_000);
  });

  it('keeps a slow poll as the fallback', () => {
    expect(BALANCE_REFRESH_MS).toBeGreaterThanOrEqual(120_000);
  });
});
