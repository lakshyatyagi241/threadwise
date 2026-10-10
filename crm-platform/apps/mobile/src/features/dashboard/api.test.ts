import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { summary, throughput, wallet, widgets } from '@/test/dashboard-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import {
  fetchEntitlements,
  fetchSummary,
  fetchThroughput,
  fetchWalletSummary,
  fetchWidgets,
} from './api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('dashboard api', () => {
  it('asks the summary, throughput and widgets endpoints for the chosen window', async () => {
    const http = mockFetch(
      jsonResponse(200, summary),
      jsonResponse(200, throughput),
      jsonResponse(200, widgets),
    );
    await expect(fetchSummary('30d')).resolves.toMatchObject({ sentDeltaPct: 25 });
    await expect(fetchThroughput('24h')).resolves.toMatchObject({ bucket: 'day' });
    await expect(fetchWidgets('qtd')).resolves.toMatchObject({ contacts: { total: 480 } });
    expect(http.calls.map((call) => call.url)).toEqual([
      expect.stringContaining('/v2/dashboard/summary?range=30d'),
      expect.stringContaining('/v2/dashboard/throughput?range=24h'),
      expect.stringContaining('/v2/dashboard/widgets?range=qtd'),
    ]);
    expect(http.calls[0]?.headers.Authorization).toBe('Bearer access-1');
  });

  it('reads the wallet and the plan features', async () => {
    const http = mockFetch(
      jsonResponse(200, wallet),
      jsonResponse(200, { features: ['unofficial_whatsapp'] }),
    );
    await expect(fetchWalletSummary()).resolves.toMatchObject({ balanceMinor: 250000 });
    await expect(fetchEntitlements()).resolves.toEqual({ features: ['unofficial_whatsapp'] });
    expect(http.calls.map((call) => call.url)).toEqual([
      expect.stringContaining('/v2/wallet/summary'),
      expect.stringContaining('/v2/billing/entitlements'),
    ]);
  });
});
