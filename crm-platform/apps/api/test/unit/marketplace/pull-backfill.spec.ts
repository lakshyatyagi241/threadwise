import { describe, expect, it, vi } from 'vitest';
import { validateMarketRecipe, type MarketRecipe } from '@crm/contracts';
import { PullConnector, type FetchLike } from '../../../src/infra/providers/marketplace';
import { PullBackfillService } from '../../../src/modules/marketplace/pull-backfill.service';
import { MarketplaceLeadPullProvider } from '../../../src/modules/marketplace/lead-pull.provider';

/**
 * A backfill of a date range at a pull connection, with the real pull connector and a made-up portal: the windows start exactly where
 * the range starts and never run past its end, the portal's pace is kept, a window that holds too much is asked again in halves, and a
 * refusal stops it without losing what came before.
 */

const DAY = 86_400;
const NOW = Date.now();
const t = (daysAgo: number) => new Date(NOW - daysAgo * DAY * 1000);

const recipe = (
  window: Record<string, unknown> | null = {},
  connector: Record<string, unknown> = {},
): MarketRecipe => {
  const v = validateMarketRecipe({
    schemaVersion: 1,
    key: 'portal',
    name: 'Portal',
    category: 'lead-sources',
    connector: {
      type: 'pull',
      request: {
        baseUrl: 'https://api.portal-example.com',
        path: '/leads',
        query:
          window === null
            ? { k: '{{cred.key}}' }
            : { from: '{{window_start}}', to: '{{window_end}}', k: '{{cred.key}}' },
      },
      response: { itemsPath: 'items' },
      ...(window === null
        ? {}
        : {
            window: {
              format: 'epoch',
              maxSeconds: DAY,
              overlapSeconds: 0,
              initialLookbackSeconds: 3600,
              maxLookbackSeconds: 30 * DAY,
              ...window,
            },
          }),
      pollIntervalSeconds: 300,
      limits: { minIntervalSeconds: 60, requestsPerMinute: 6 },
      maxItemsPerPoll: 3,
      ...connector,
    },
    authFields: [{ key: 'key', label: 'Key', kind: 'secret', required: true }],
    mapping: {
      mode: 'explicit',
      externalId: { from: 'id' },
      fields: [{ to: 'name', from: 'name' }],
    },
  });
  if (!v.ok) throw new Error(JSON.stringify(v.problems));
  return v.recipe;
};

interface Asked {
  from: number;
  to: number;
}

function build(opts: {
  recipe?: MarketRecipe;
  status?: number;
  /** Leads the portal holds, by the second they were made. */
  leads?: Array<{ id: string; at: number }>;
  fail?: (n: number) => { status: number; body?: unknown } | null;
  delivered?: { accepted?: number; duplicates?: number; failed?: number };
  connection?: 'active' | 'paused' | 'none';
  installation?: 'active' | 'paused';
}) {
  const asked: Asked[] = [];
  let calls = 0;
  const fetchImpl: FetchLike = async (url) => {
    const q = new URL(String(url)).searchParams;
    const from = Number(q.get('from'));
    const to = Number(q.get('to'));
    asked.push({ from, to });
    calls += 1;
    const err = opts.fail?.(calls);
    if (err) return { status: err.status, text: async () => JSON.stringify(err.body ?? {}) };
    const items = (opts.leads ?? [])
      .filter((l) => l.at >= from && l.at < to)
      .map((l) => ({ id: l.id, name: `N ${l.id}` }));
    return { status: 200, text: async () => JSON.stringify({ items }) };
  };
  const sleeps: number[] = [];
  const marked = vi.fn(async () => undefined);
  const processed = vi.fn(async (_t: unknown, leads: unknown[]) => ({
    received: leads.length,
    accepted: opts.delivered?.accepted ?? leads.length,
    duplicates: opts.delivered?.duplicates ?? 0,
    failed: opts.delivered?.failed ?? 0,
    rejected: 0,
    pipelineDown: false,
    firstError: null,
    outcomes: [],
  }));
  const r = opts.recipe ?? recipe();
  const svc = new PullBackfillService(
    { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) } as never,
    {
      byUuid: async () =>
        opts.connection === 'none'
          ? {
              id: 1,
              uuid: 'i1',
              status: 'active',
              app: { status: 'active', slug: 'p', name: 'P' },
              recipe: r,
              config: {},
              credentialsEnc: null,
              connection: null,
            }
          : {
              id: 1,
              uuid: 'i1',
              status: opts.installation ?? 'active',
              app: { status: 'active', slug: 'p', name: 'P' },
              recipe: r,
              config: {},
              credentialsEnc: null,
              connection: { id: 9, status: opts.connection ?? 'active', leadSourceId: 4 },
            },
    } as never,
    {
      stateOf: async () => ({ lastPollAt: null, pollWindowSeconds: null }),
      markPolling: marked,
    } as never,
    { get: () => new PullConnector(fetchImpl, async () => undefined) } as never,
    { process: processed } as never,
    { decrypt: (s: string) => s } as never,
  );
  svc.sleep = async (ms) => {
    sleeps.push(ms);
  };
  return { svc, asked, sleeps, marked, processed };
}

const progressed = () => {
  const seen: Array<{ windowsDone: number; accepted: number }> = [];
  return {
    fn: async (c: { windowsDone: number; accepted: number }) => void seen.push({ ...c }),
    seen,
  };
};

describe('PullBackfillService', () => {
  it('asks window by window from the start of the range to its end, never past it, at the portal pace', async () => {
    const from = t(4);
    const to = t(1);
    const leads = [
      { id: 'a', at: Math.floor(t(3.5).getTime() / 1000) },
      { id: 'b', at: Math.floor(t(2.5).getTime() / 1000) },
      { id: 'c', at: Math.floor(t(1.5).getTime() / 1000) },
    ];
    const m = build({ leads });
    const p = progressed();
    const out = await m.svc.run(1, 'i1', from, to, p.fn);

    expect(out.status).toBe('ok');
    expect(out.counts).toMatchObject({
      fetched: 3,
      accepted: 3,
      duplicates: 0,
      failed: 0,
      windowsDone: 3,
      windowsTotal: 3,
    });
    expect(m.asked).toHaveLength(3);
    // the first window starts at the range, each next one where the last ended, and the last ends at the range's end
    expect(m.asked[0]!.from).toBe(Math.floor(from.getTime() / 1000));
    expect(m.asked[1]!.from).toBe(m.asked[0]!.to);
    expect(m.asked[2]!.from).toBe(m.asked[1]!.to);
    expect(m.asked[2]!.to).toBeLessThanOrEqual(Math.floor(to.getTime() / 1000) + 1);
    expect(Math.max(...m.asked.map((a) => a.to))).toBeLessThanOrEqual(
      Math.floor(to.getTime() / 1000) + 1,
    );
    // the portal's minimum interval is kept between requests, and every request is marked on the connection first
    expect(m.sleeps.filter((ms) => ms === 60_000)).toHaveLength(2);
    expect(m.marked).toHaveBeenCalledTimes(3);
    expect(p.seen.at(-1)).toMatchObject({ windowsDone: 3, accepted: 3 });
    expect(m.processed).toHaveBeenCalledTimes(3);
    // quiet repeats: a lead the pipeline already holds is not counted again as a delivery
    expect((m.processed.mock.calls[0] as unknown[])[4]).toMatchObject({ quietRepeats: true });
  });

  it('a window with too many leads is asked again in halves and nothing is lost or counted twice', async () => {
    const base = Math.floor(t(2).getTime() / 1000);
    const leads = Array.from({ length: 5 }, (_v, i) => ({ id: `x${i}`, at: base + 100 + i * 100 }));
    const m = build({ leads });
    const out = await m.svc.run(1, 'i1', t(2), t(1), progressed().fn);
    expect(out.status).toBe('ok');
    expect(out.counts.accepted).toBe(5);
    // more requests than windows: the first answer was too large to take
    expect(m.asked.length).toBeGreaterThan(1);
    expect(m.processed.mock.calls.reduce((n, c) => n + (c[1] as unknown[]).length, 0)).toBe(5);
  });

  it('keeps going after a retryable failure and gives up after three', async () => {
    const flaky = build({ leads: [], fail: (n) => (n === 1 ? { status: 503 } : null) });
    const ok = await flaky.svc.run(1, 'i1', t(2), t(1), progressed().fn);
    expect(ok.status).toBe('ok');
    expect(flaky.asked.length).toBeGreaterThanOrEqual(2);

    const down = build({ leads: [], fail: () => ({ status: 503 }) });
    const out = await down.svc.run(1, 'i1', t(2), t(1), progressed().fn);
    expect(out.status).toBe('failed');
    expect(down.asked).toHaveLength(3);
  });

  it('a refusal of the key stops it with a stable code, and what came before stays in', async () => {
    const recipeWith = recipe({}, {});
    const m = build({
      recipe: recipeWith,
      leads: [{ id: 'first', at: Math.floor(t(3.5).getTime() / 1000) }],
      fail: (n) => (n >= 2 ? { status: 401 } : null),
    });
    const out = await m.svc.run(1, 'i1', t(4), t(1), progressed().fn);
    expect(out.counts.accepted).toBe(1);
    expect(out.status).toBe('partial');
    expect(out.error).toBeDefined();
    expect(JSON.stringify(out)).not.toContain('portal-example');
  });

  it('leads that could not be handed over make it partial, so running it again completes it', async () => {
    const m = build({
      leads: [{ id: 'z', at: Math.floor(t(1.5).getTime() / 1000) }],
      delivered: { accepted: 0, failed: 1 },
    });
    const out = await m.svc.run(1, 'i1', t(2), t(1), progressed().fn);
    expect(out.status).toBe('partial');
    expect(out.counts.failed).toBe(1);
  });

  it('refuses what cannot be backfilled: a recipe with no window, a connection that is off, a range beyond the portal history', async () => {
    const noWindow = build({ recipe: recipe(null) });
    expect(await noWindow.svc.run(1, 'i1', t(2), t(1), progressed().fn)).toMatchObject({
      status: 'failed',
      error: 'not_supported',
    });
    expect(noWindow.asked).toHaveLength(0);

    const paused = build({ connection: 'paused' });
    expect(await paused.svc.run(1, 'i1', t(2), t(1), progressed().fn)).toMatchObject({
      error: 'not_active',
    });
    const none = build({ connection: 'none' });
    expect(await none.svc.run(1, 'i1', t(2), t(1), progressed().fn)).toMatchObject({
      error: 'not_supported',
    });

    const old = build({});
    expect(await old.svc.run(1, 'i1', t(60), t(50), progressed().fn)).toMatchObject({
      status: 'failed',
      error: 'range_too_old',
    });
    expect(old.asked).toHaveLength(0);
  });

  it('a range that starts before the portal history is shortened to what the portal keeps', async () => {
    const m = build({});
    const out = await m.svc.run(1, 'i1', t(40), t(25), progressed().fn);
    expect(out.status).toBe('ok');
    const earliest = Math.min(...m.asked.map((a) => a.from));
    expect(earliest).toBeGreaterThanOrEqual(Math.floor((NOW - 30 * DAY * 1000) / 1000));
  });

  it('reach is the history less a margin, and zero without a window', () => {
    expect(PullBackfillService.reachSeconds(undefined)).toBe(0);
    expect(PullBackfillService.reachSeconds({ maxLookbackSeconds: 30 * DAY })).toBe(
      30 * DAY - 3600,
    );
    expect(PullBackfillService.reachSeconds({})).toBe(365 * DAY - 3600);
  });
});

describe('MarketplaceLeadPullProvider', () => {
  const installation = (
    connectorOver: Record<string, unknown> | null = {},
    window: Record<string, unknown> | null = {},
  ) => ({
    id: 1,
    uuid: 'i1',
    recipe: recipe(window, connectorOver ?? {}),
    connection: { id: 9 },
  });
  const make = (row: unknown, run?: unknown) =>
    new MarketplaceLeadPullProvider(
      { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) } as never,
      { byUuid: async () => row } as never,
      {
        run: run ?? (async () => ({ status: 'ok', accepted: 2, duplicates: 1, failed: 0 })),
      } as never,
      {
        run: async () => ({
          status: 'ok',
          counts: {
            fetched: 0,
            accepted: 0,
            duplicates: 0,
            failed: 0,
            windowsDone: 0,
            windowsTotal: 0,
          },
        }),
      } as never,
    );
  const src = (over: Record<string, unknown> = {}) => ({
    id: 3,
    uuid: 's',
    kind: 'connector',
    providerKey: 'P',
    externalRef: '11111111-1111-4111-8111-111111111111',
    ...over,
  });

  it('knows only connector sources of a pull installation, and what the portal allows', async () => {
    const p = make(installation());
    expect(await p.capabilities(1, src())).toEqual({
      sync: true,
      backfill: true,
      minIntervalSeconds: 60,
      maxBackfillSeconds: 30 * DAY - 3600,
    });
    expect(await p.capabilities(1, src({ kind: 'webhook' }))).toBeNull();
    expect(await p.capabilities(1, src({ externalRef: null }))).toBeNull();
    expect(await make(null).capabilities(1, src())).toBeNull();
    // a pull recipe with no date window can sync but not backfill
    expect(await make(installation({}, null)).capabilities(1, src())).toMatchObject({
      sync: true,
      backfill: false,
      maxBackfillSeconds: 0,
    });
  });

  it('sync runs the poller step and reports what it did; a poll that was too soon is throttled, not failed', async () => {
    const seen: unknown[] = [];
    const req = {
      orgId: 1,
      source: src(),
      mode: 'sync' as const,
      from: null,
      to: null,
      progress: async (p: unknown) => void seen.push(p),
    };
    const ok = await make(installation()).pull(req);
    expect(ok).toMatchObject({
      status: 'ok',
      progress: { fetched: 3, accepted: 2, duplicates: 1 },
    });
    expect(seen).toHaveLength(1);

    const soon = await make(installation(), async () => ({
      status: 'skipped',
      accepted: 0,
      duplicates: 0,
      failed: 0,
    })).pull(req);
    expect(soon).toMatchObject({ status: 'throttled', error: 'not_now' });
    const retry = await make(installation(), async () => ({
      status: 'retry',
      accepted: 1,
      duplicates: 0,
      failed: 1,
    })).pull(req);
    expect(retry).toMatchObject({ status: 'partial' });
    const bad = await make(installation(), async () => ({
      status: 'failed',
      accepted: 0,
      duplicates: 0,
      failed: 1,
    })).pull(req);
    expect(bad).toMatchObject({ status: 'failed', error: 'provider_error' });
  });
});
