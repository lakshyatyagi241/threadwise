import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadPullProgress, LeadPullRequest } from '../../../src/modules/leads/lead-pull.port';
import type { LeadIngestResult } from '../../../src/modules/leads/lead-ingest.port';
import { MetaLeadPullService } from '../../../src/modules/meta-lead-ads/meta-lead-pull.service';
import { MetaLeadAdsGraphClient } from '../../../src/infra/providers/meta-lead-ads/meta-lead-ads-graph.client';
import { aLead, FakeMetaLeadAds } from '../../support/fake-meta-lead-ads-graph';
import type { GraphLead } from '../../../src/infra/providers/meta-lead-ads/meta-lead-ads.port';

/**
 * Pulling a Meta lead form ("Sync now" and backfill, BL-204) with every collaborator replaced: the Graph is the fake (no request leaves the
 * process), the pipeline is a recorder and the clock never waits. What is asserted is the shape of the pull: which windows it asks for,
 * in what order the leads go to the pipeline, what it counts, how it backs off, and where it stops.
 */

const ORG = 9;
const NOW = new Date('2026-10-16T12:00:00Z');
const DAY = 86_400_000;

const meta = new FakeMetaLeadAds();

const form = (over: Record<string, unknown> = {}) => ({
  id: 4,
  uuid: 'f-uuid',
  pageId: 'page-1',
  formId: 'form-1',
  name: 'Diwali',
  status: 'ACTIVE',
  locale: 'en_US',
  questions: [],
  checkboxes: [],
  privacyPolicyUrl: null,
  sourceId: 12,
  sourceUuid: 'src-uuid',
  sourceStatus: 'active',
  connectedAt: new Date(NOW.getTime() - 3 * DAY),
  lastLeadAt: null,
  lastError: null,
  sweepCheckpointAt: new Date(NOW.getTime() - 3600_000),
  lastSweepAt: null,
  ...over,
});

interface Setup {
  form?: ReturnType<typeof form> | undefined;
  pageEnabled?: boolean;
  fb?: Record<string, unknown> | undefined;
  held?: string[];
  deliver?: (lead: GraphLead) => Promise<LeadIngestResult>;
  settledMissing?: boolean;
}

function make(s: Setup = {}) {
  const delivered: string[] = [];
  const deliver = vi.fn(async (_org: number, _form: unknown, lead: GraphLead) => {
    delivered.push(lead.id);
    return s.deliver ? s.deliver(lead) : ({ status: 'created' } as LeadIngestResult);
  });
  const recordRefusal = vi.fn(async () => undefined);
  const recordFormSweep = vi.fn(async () => undefined);
  const settled = vi.fn(async (_o: number, _s: number, ids: readonly string[]) =>
    ids.filter((id) => (s.held ?? []).includes(id)),
  );
  const svc = new MetaLeadPullService(
    { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) } as never,
    {
      findFormBySourceUuid: async () => ('form' in s ? s.form : form()),
      findPage: async () => ({ enabled: s.pageEnabled ?? true }),
      recordFormSweep,
    } as never,
    {
      findByPageId: async () =>
        'fb' in s
          ? s.fb
          : {
              pageId: 'page-1',
              status: 'connected',
              accessToken: 'sealed',
              scopes: [
                'pages_show_list',
                'leads_retrieval',
                'pages_manage_ads',
                'pages_read_engagement',
              ],
            },
    } as never,
    { decrypt: () => 'page-token' } as never,
    { deliver, recordRefusal } as never,
    new MetaLeadAdsGraphClient({ settings: { graphVersion: 'v21.0', appId: '1' } } as never),
    { ingest: vi.fn(), ...(s.settledMissing ? {} : { settled }) } as never,
  );
  const progress: LeadPullProgress[] = [];
  const request = (over: Partial<LeadPullRequest> = {}): LeadPullRequest => ({
    orgId: ORG,
    source: {
      id: 12,
      uuid: 'src-uuid',
      kind: 'meta_lead_ads',
      providerKey: 'Facebook',
      externalRef: 'meta_lead_form:page-1:form-1',
    },
    mode: 'sync',
    from: null,
    to: null,
    progress: async (p) => {
      progress.push({ ...p });
    },
    ...over,
  });
  return { svc, delivered, deliver, recordRefusal, recordFormSweep, settled, progress, request };
}

const sleeps: number[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  meta.reset();
  meta.install();
  sleeps.length = 0;
  vi.spyOn(MetaLeadPullService.prototype, 'sleep').mockImplementation(async (ms: number) => {
    sleeps.push(ms);
  });
});

afterEach(() => {
  meta.uninstall();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const lead = (minutesAgo: number, id?: string) =>
  aLead('form-1', {
    ...(id ? { id } : {}),
    createdTime: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  });

describe('a backfill', () => {
  const range = { mode: 'backfill' as const, from: new Date(NOW.getTime() - 20 * DAY), to: NOW };

  it('asks Meta for each week of the range, oldest first, and hands the leads over oldest first', async () => {
    const old = lead(19 * 24 * 60, 'old');
    const mid = lead(10 * 24 * 60, 'mid');
    const fresh = lead(60, 'fresh');
    meta.leads.set('form-1', [fresh, old, mid]);
    const m = make();
    const out = await m.svc.run(m.request(range));

    expect(out.status).toBe('ok');
    expect(m.delivered).toEqual(['old', 'mid', 'fresh']);
    expect(out.progress).toMatchObject({
      fetched: 3,
      accepted: 3,
      duplicates: 0,
      failed: 0,
      windowsDone: 3,
      windowsTotal: 3,
    });

    const asks = meta
      .callsTo('pageFormLeads')
      .map((c) => c.args[1] as { sinceEpochSeconds: number; untilEpochSeconds: number });
    expect(asks).toHaveLength(3);
    for (let i = 1; i < asks.length; i++) {
      // each window starts where the last one ended: no gap and no overlap
      expect(asks[i]!.sinceEpochSeconds + 1).toBe(asks[i - 1]!.untilEpochSeconds);
    }
    // the last window ends now, the first starts at the start of the range
    expect(asks.at(-1)!.untilEpochSeconds).toBe(Math.ceil(NOW.getTime() / 1000));
    expect(asks[0]!.sinceEpochSeconds + 1).toBe(Math.ceil((NOW.getTime() - 20 * DAY) / 1000));
  });

  it('never reaches past the ninety days Meta keeps, and says so when nothing is left', async () => {
    const m = make();
    const out = await m.svc.run(
      m.request({
        mode: 'backfill',
        from: new Date(NOW.getTime() - 200 * DAY),
        to: new Date(NOW.getTime() - 120 * DAY),
      }),
    );
    expect(out).toMatchObject({ status: 'failed', error: 'range_too_old' });
    expect(meta.callsTo('pageFormLeads')).toHaveLength(0);

    meta.leads.set('form-1', []);
    const wide = await m.svc.run(
      m.request({ mode: 'backfill', from: new Date(NOW.getTime() - 400 * DAY), to: NOW }),
    );
    expect(wide.status).toBe('ok');
    expect(wide.progress.windowsTotal).toBe(13);
  });

  it('a backfill without a range is refused, and does not move the sweep checkpoint when it succeeds', async () => {
    const m = make();
    expect(await m.svc.run(m.request({ mode: 'backfill', from: null, to: null }))).toMatchObject({
      status: 'failed',
      error: 'range_invalid',
    });
    meta.leads.set('form-1', [lead(60)]);
    expect((await m.svc.run(m.request(range))).status).toBe('ok');
    expect(m.recordFormSweep).not.toHaveBeenCalled();
  });

  it('follows Meta paging: a hundred leads a request, and counts every lead once', async () => {
    meta.leads.set(
      'form-1',
      Array.from({ length: 250 }, (_, i) => lead(i + 1, `L${i}`)),
    );
    const m = make();
    const out = await m.svc.run(
      m.request({ mode: 'backfill', from: new Date(NOW.getTime() - 3 * DAY), to: NOW }),
    );
    expect(out.status).toBe('ok');
    expect(meta.callsTo('pageFormLeads')).toHaveLength(3);
    expect(out.progress).toMatchObject({ fetched: 250, accepted: 250 });
    expect(new Set(m.delivered).size).toBe(250);
    // oldest first across the pages Meta lists newest first
    expect(m.delivered[0]).toBe('L249');
    expect(m.delivered.at(-1)).toBe('L0');
  });

  it('cuts a window that holds too many leads into halves instead of holding it whole', async () => {
    meta.leads.set(
      'form-1',
      Array.from({ length: 1100 }, (_, i) => lead(i * 5 + 1, `B${i}`)),
    );
    const m = make();
    const out = await m.svc.run(
      m.request({ mode: 'backfill', from: new Date(NOW.getTime() - 5 * DAY), to: NOW }),
    );
    expect(out.status).toBe('ok');
    expect(out.progress.windowsTotal).toBeGreaterThan(1);
    expect(out.progress.windowsDone).toBe(out.progress.windowsTotal);
    expect(out.progress.fetched).toBe(1100);
    expect(m.delivered).toHaveLength(1100);
    expect(new Set(m.delivered).size).toBe(1100);
    // still oldest first overall
    expect(m.delivered[0]).toBe('B1099');
    expect(m.delivered.at(-1)).toBe('B0');
  });

  it('paces its requests: never two in the same second', async () => {
    meta.leads.set(
      'form-1',
      Array.from({ length: 150 }, (_, i) => lead(i + 1)),
    );
    const m = make();
    await m.svc.run(
      m.request({ mode: 'backfill', from: new Date(NOW.getTime() - 3 * DAY), to: NOW }),
    );
    // the frozen clock never advances, so every request after the first asked the pace to wait a second
    expect(sleeps.filter((ms) => ms > 0 && ms <= 1000).length).toBeGreaterThanOrEqual(1);
  });
});

describe('what it counts', () => {
  it('leads the pipeline already holds are not delivered again and count as already known', async () => {
    meta.leads.set('form-1', [lead(30, 'a'), lead(20, 'b'), lead(10, 'c')]);
    const m = make({ held: ['a', 'c'] });
    const out = await m.svc.run(m.request());
    expect(m.delivered).toEqual(['b']);
    expect(out.progress).toMatchObject({ fetched: 3, accepted: 1, duplicates: 2, failed: 0 });
  });

  it('without the pipeline’s "already held" check it still counts a duplicate the pipeline reports', async () => {
    meta.leads.set('form-1', [lead(30, 'a'), lead(20, 'b')]);
    const m = make({
      settledMissing: true,
      deliver: async (l) => ({ status: l.id === 'a' ? 'duplicate' : 'updated' }),
    });
    const out = await m.svc.run(m.request());
    expect(out.progress).toMatchObject({ fetched: 2, accepted: 1, duplicates: 1 });
  });

  it('a lead the pipeline could not store is counted failed and makes the run partial, and the checkpoint stays', async () => {
    meta.leads.set('form-1', [lead(30, 'a'), lead(20, 'b')]);
    const m = make({ deliver: async (l) => ({ status: l.id === 'a' ? 'failed' : 'created' }) });
    const out = await m.svc.run(m.request());
    expect(out).toMatchObject({ status: 'partial', error: 'incomplete' });
    expect(out.progress).toMatchObject({ accepted: 1, failed: 1 });
    expect(m.recordFormSweep).not.toHaveBeenCalled();
  });

  it('a delivery that throws does not stop the others', async () => {
    meta.leads.set('form-1', [lead(30, 'a'), lead(20, 'b'), lead(10, 'c')]);
    const m = make({
      deliver: async (l) => {
        if (l.id === 'b') throw new Error('boom');
        return { status: 'created' };
      },
    });
    const out = await m.svc.run(m.request());
    expect(m.delivered).toEqual(['a', 'b', 'c']);
    expect(out.progress).toMatchObject({ accepted: 2, failed: 1 });
    expect(out.status).toBe('partial');
  });

  it('reports progress as it goes, so the screen moves', async () => {
    meta.leads.set('form-1', [lead(30, 'a'), lead(20, 'b')]);
    const m = make();
    await m.svc.run(m.request());
    expect(m.progress.length).toBeGreaterThanOrEqual(2);
    expect(m.progress.at(-1)).toMatchObject({ accepted: 2, windowsDone: 1, windowsTotal: 1 });
  });
});

describe('sync now', () => {
  it('reads from the form’s checkpoint less the sweep’s overlap, to now, and moves the checkpoint when it read everything', async () => {
    meta.leads.set('form-1', [lead(30, 'a')]);
    const m = make();
    const out = await m.svc.run(m.request());
    expect(out.status).toBe('ok');
    const ask = meta.callsTo('pageFormLeads')[0]!.args[1] as { sinceEpochSeconds: number };
    // checkpoint was an hour ago; the sweep re-reads two hours before it
    expect(NOW.getTime() / 1000 - ask.sinceEpochSeconds).toBeGreaterThan(3 * 3600 - 5);
    expect(NOW.getTime() / 1000 - ask.sinceEpochSeconds).toBeLessThan(3 * 3600 + 5);
    expect(m.recordFormSweep).toHaveBeenCalledTimes(1);
    expect((m.recordFormSweep.mock.calls[0] as unknown[])[3]).toEqual(NOW);
  });
});

describe('when Meta slows us down', () => {
  it('waits out a rate limit with a growing pause and goes on, losing nothing', async () => {
    meta.leads.set('form-1', [lead(30, 'a')]);
    meta.fail('pageFormLeads', 613, 'Calls to this api have exceeded the rate limit.', 2);
    const m = make();
    const out = await m.svc.run(m.request());
    expect(out.status).toBe('ok');
    expect(m.delivered).toEqual(['a']);
    // 30 s then 60 s, in pieces of at most ten seconds (the run says it is alive between them)
    const long = sleeps.filter((ms) => ms >= 5_000);
    expect(long.reduce((a, b) => a + b, 0)).toBe(90_000);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(10_000);
    expect(m.progress.length).toBeGreaterThanOrEqual(9);
  });

  it('a plain failure waits less than a rate limit', async () => {
    meta.leads.set('form-1', [lead(30, 'a')]);
    meta.fail('pageFormLeads', 2, 'Service temporarily unavailable', 1);
    const m = make();
    expect((await m.svc.run(m.request())).status).toBe('ok');
    expect(sleeps.filter((ms) => ms >= 1_500).reduce((a, b) => a + b, 0)).toBe(2_000);
  });

  it('stops as throttled when the limit does not lift, keeping what it already handed over', async () => {
    meta.leads.set('form-1', [lead(30, 'a')]);
    meta.fail('pageFormLeads', 4, 'Application request limit reached');
    const m = make();
    const out = await m.svc.run(m.request());
    expect(out).toMatchObject({ status: 'throttled', error: 'too_soon' });
    expect(m.delivered).toEqual([]);
    expect(meta.callsTo('pageFormLeads')).toHaveLength(5);
    expect(m.recordFormSweep).not.toHaveBeenCalled();
    // an exhausted retry is Meta being busy, not a refusal: nothing is written on the Page
    expect(m.recordRefusal).not.toHaveBeenCalled();
  });

  it('stops as a provider error when Meta keeps failing, partial if some leads were already in', async () => {
    meta.fail('pageFormLeads', 1, 'An unknown error occurred');
    const none = make();
    expect(await none.svc.run(none.request())).toMatchObject({
      status: 'failed',
      error: 'provider_error',
    });

    meta.reset();
    // a backfill of two windows: the first is read and handed over, the second never answers
    meta.leads.set('form-1', [lead(9 * 24 * 60, 'a')]);
    meta.fail('pageFormLeads', 1, 'down', Infinity, 1);
    const partial = make();
    const out = await partial.svc.run(
      partial.request({ mode: 'backfill', from: new Date(NOW.getTime() - 10 * DAY), to: NOW }),
    );
    expect(out).toMatchObject({ status: 'partial', error: 'provider_error' });
    expect(partial.delivered).toEqual(['a']);
  });
});

describe('when Meta refuses', () => {
  it('a revoked token stops the run at once, is written on the Page and is asked for again by nobody', async () => {
    meta.leads.set('form-1', [lead(30, 'a')]);
    meta.fail('pageFormLeads', 190, 'Invalid OAuth access token.');
    const m = make();
    const out = await m.svc.run(m.request());
    expect(out).toMatchObject({ status: 'failed', error: 'credentials_refused' });
    expect(meta.callsTo('pageFormLeads')).toHaveLength(1);
    expect(sleeps.filter((ms) => ms > 1000)).toEqual([]);
    expect(m.recordRefusal).toHaveBeenCalledWith(
      ORG,
      'page-1',
      expect.anything(),
      'token',
      'Invalid OAuth access token.',
    );
  });

  it('a withheld permission says so and is written as a permission problem', async () => {
    meta.fail('pageFormLeads', 200, '(#200) Requires leads_retrieval permission');
    const m = make();
    const out = await m.svc.run(m.request());
    expect(out).toMatchObject({ status: 'failed', error: 'permission_missing' });
    expect((m.recordRefusal.mock.calls[0] as unknown[])[3]).toBe('permission');
  });

  it('any other refusal is a provider error, never Meta’s words', async () => {
    meta.fail('pageFormLeads', 100, 'Unsupported get request <secret detail>');
    const m = make();
    const out = await m.svc.run(m.request());
    expect(out).toMatchObject({ status: 'failed', error: 'provider_error' });
    expect(JSON.stringify(out)).not.toContain('secret detail');
  });
});

describe('what it will not pull', () => {
  it('a source that is not a picked form', async () => {
    const m = make({ form: undefined });
    expect(await m.svc.run(m.request())).toMatchObject({
      status: 'failed',
      error: 'not_supported',
    });
  });

  it('a Page with lead sync off, a Page that is not connected, a paused source: not active, and Meta is not asked', async () => {
    for (const s of [
      { pageEnabled: false },
      { fb: { pageId: 'page-1', status: 'expired', accessToken: 'x', scopes: [] } },
      { form: form({ sourceStatus: 'paused' }) },
      { fb: undefined },
    ] as Setup[]) {
      const m = make(s);
      expect(await m.svc.run(m.request())).toMatchObject({ status: 'failed', error: 'not_active' });
    }
    expect(meta.callsTo('pageFormLeads')).toHaveLength(0);
  });

  it('a Page connected without the lead permissions', async () => {
    const m = make({
      fb: { pageId: 'page-1', status: 'connected', accessToken: 'x', scopes: ['pages_show_list'] },
    });
    expect(await m.svc.run(m.request())).toMatchObject({
      status: 'failed',
      error: 'permission_missing',
    });
    expect(meta.callsTo('pageFormLeads')).toHaveLength(0);
  });
});
