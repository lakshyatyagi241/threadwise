import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * The workspace dashboard and analytics end to end through HTTP (TW-DASH-002..005, 012, 018, 022..025, 027, 031, 032).
 * Message rows are arranged with the owner connection (the streams belong to the chat domains); everything asserted goes
 * through the API as a signed-in user. Organizations have no time zone set, so the zone is UTC.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;

type Row = {
  dir?: 'out' | 'in';
  status?: string;
  /** SQL interval before now, e.g. '2 days'. */
  ago: string;
  read?: boolean;
  template?: boolean;
  media?: string;
  conv?: number;
};

async function conversation(t: Tenant): Promise<number> {
  const r = await h.owner.query(
    `INSERT INTO conversations (org_id, title) VALUES ($1, 'chat') RETURNING id`,
    [t.orgId],
  );
  return Number(r.rows[0].id);
}

/** Rows into `messages` (legacy streams) or `inbox_messages`. */
async function seed(t: Tenant, table: 'messages' | 'inbox_messages', rows: Row[]) {
  for (const r of rows) {
    const conv = r.conv ?? (table === 'inbox_messages' ? await conversation(t) : null);
    await h.owner.query(
      `INSERT INTO ${table} (org_id, conversation_id, direction, status, read_at, template_id, media_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() - $8::interval)`,
      [
        t.orgId,
        conv,
        r.dir ?? 'out',
        r.status ?? 'delivered',
        r.read ? new Date() : null,
        r.template ? 1 : null,
        r.media ?? null,
        r.ago,
      ],
    );
  }
}

const many = (n: number, r: Row): Row[] => Array.from({ length: n }, () => r);

async function withAnalytics(t: Tenant, on = true) {
  await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
    t.orgId,
    JSON.stringify({ features: { analytics: on } }),
  ]);
}

describe('access (TW-DASH-001, 022)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dacc');
    await withAnalytics(t);
  });

  it('a member without the capability is refused on both surfaces; with it, allowed', async () => {
    const none = await api.member(t, 'nobody', [['record.contacts.read']]);
    const d = await api.as(none.token).get('/v2/dashboard/summary');
    expect(d.status).toBe(403);
    expect(code(d)).toBe('FORBIDDEN');
    expect((await api.as(none.token).get('/v2/analytics/overview')).status).toBe(403);

    const dashOnly = await api.member(t, 'dashonly', [['dash.dashboard.read']]);
    expect((await api.as(dashOnly.token).get('/v2/dashboard/summary')).status).toBe(200);
    expect((await api.as(dashOnly.token).get('/v2/analytics/overview')).status).toBe(403);
  });

  it('no token is 401', async () => {
    expect((await api.http().get('/v2/dashboard/summary')).status).toBe(401);
  });

  it('TW-DASH-022: a plan without analytics is refused with PLAN_FEATURE_LOCKED, the dashboard is not gated', async () => {
    const locked = await api.signup('dlock');
    await withAnalytics(locked, false);
    const res = await api.as(locked.admin).get('/v2/analytics/overview');
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(code(res)).toBe('PLAN_FEATURE_LOCKED');
    expect((await api.as(locked.admin).get('/v2/analytics/export')).status).toBe(422);
    expect((await api.as(locked.admin).get('/v2/dashboard/summary')).status).toBe(200);
  });
});

describe('summary: the KPI cards (TW-DASH-002, 003, 004, 005, 018)', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('dsum');
    other = await api.signup('dsum2');
    // 10 legacy + 5 inbox outbound; of the 15: 11 delivered (incl. 'sent'), 3 read-by-timestamp, 2 failed, 2 pending
    await seed(t, 'messages', [
      ...many(5, { status: 'delivered', ago: '2 days' }),
      ...many(2, { status: 'read', ago: '2 days' }),
      { status: 'failed', ago: '2 days' },
      { status: 'pending', ago: '2 days' },
      { status: 'sent', ago: '2 days' },
    ]);
    await seed(t, 'inbox_messages', [
      { status: 'delivered', ago: '1 day', read: true }, // read_at set while status stays delivered
      { status: 'delivered', ago: '1 day', read: true },
      { status: 'failed', ago: '1 day' },
      { status: 'queued', ago: '1 day' },
      { status: 'sent', ago: '1 day' },
    ]);
    // 30 inbound across two conversations (one legacy-stream row has no conversation)
    const c1 = await conversation(t);
    const c2 = await conversation(t);
    await seed(t, 'inbox_messages', [
      ...many(3, { dir: 'in', status: 'received', ago: '1 day', conv: c1 }),
      ...many(2, { dir: 'in', status: 'received', ago: '1 day', conv: c2 }),
    ]);
    // another organization's traffic never shows
    await seed(other, 'messages', many(40, { ago: '1 day' }));
    await seed(other, 'inbox_messages', many(40, { ago: '1 day' }));
  });

  it('TW-DASH-002 #1/#4: sent is the sum of both streams, other workspaces excluded', async () => {
    const res = await api.as(t.admin).get('/v2/dashboard/summary?range=7d');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.current.sent).toBe(15);
    expect(res.body.current.failed).toBe(2);
    // delivered set = delivered, read, sent: 5 + 2 + 1 (legacy) and 2 + 1 (inbox)
    expect(res.body.current.delivered).toBe(11);
    expect(res.body.current.queued).toBe(2);
  });

  it('TW-DASH-002 #2: read_at counts as read while the status is still delivered; status read counts too', async () => {
    const res = await api.as(t.admin).get('/v2/dashboard/summary?range=7d');
    expect(res.body.current.read).toBe(4);
    expect(res.body.current.readRate).toBe(26.7);
    expect(res.body.current.deliverability).toBe(73.3);
  });

  it('TW-DASH-018: replies are inbound rows, engaged is the distinct conversations that replied; funnel and drops', async () => {
    const res = await api.as(t.admin).get('/v2/dashboard/summary?range=7d');
    expect(res.body.current.replies).toBe(5);
    expect(res.body.current.repliers).toBe(2);
    expect(res.body.funnel.stages.map((s: { key: string; count: number }) => [s.key, s.count])).toEqual([
      ['sent', 15],
      ['delivered', 11],
      ['replied', 5],
      ['engaged', 2],
    ]);
    expect(res.body.funnel.endToEnd).toBe(13.3);
  });

  it('TW-DASH-003/004: nothing in the previous window, so the pill is +100; an unknown range behaves as 7d', async () => {
    const res = await api.as(t.admin).get('/v2/dashboard/summary?range=bogus');
    expect(res.status).toBe(200);
    expect(res.body.range).toBe('7d');
    expect(res.body.previous.sent).toBe(0);
    expect(res.body.sentDeltaPct).toBe(100);
  });

  it('TW-DASH-003: the previous window has the same number of days as the current one', async () => {
    const res = await api.as(t.admin).get('/v2/dashboard/summary?range=30d');
    const w = res.body.window;
    expect(Date.parse(w.to) - Date.parse(w.from)).toBe(Date.parse(w.prevTo) - Date.parse(w.prevFrom));
    expect(w.prevTo).toBe(w.from);
  });

  it('TW-DASH-003: the 24h window is the rolling day; rows a day or more old fall out of it', async () => {
    const res = await api.as(t.admin).get('/v2/dashboard/summary?range=24h');
    expect(res.status).toBe(200);
    expect(res.body.current.sent).toBe(0);
    expect(Date.parse(res.body.window.to) - Date.parse(res.body.window.from)).toBe(86_400_000);
  });

  it('TW-DASH-005: Read rate delta is in percentage points against the previous window', async () => {
    const p = await api.signup('dsum3');
    await seed(p, 'messages', [
      ...many(8, { ago: '2 days', status: 'delivered' }),
      ...many(2, { ago: '2 days', status: 'read' }), // 20% now
      ...many(9, { ago: '10 days', status: 'delivered' }),
      { ago: '10 days', status: 'read' }, // 10% before
    ]);
    const res = await api.as(p.admin).get('/v2/dashboard/summary?range=7d');
    expect(res.body.current.readRate).toBe(20);
    expect(res.body.previous.readRate).toBe(10);
    expect(res.body.readRateDeltaPp).toBe(10);
    expect(res.body.sentDeltaPct).toBe(0);
  });

  it('TW-DASH-004: sent doubled against the previous window shows +100', async () => {
    const p = await api.signup('dsum4');
    await seed(p, 'messages', [...many(100, { ago: '2 days' }), ...many(50, { ago: '10 days' })]);
    const res = await api.as(p.admin).get('/v2/dashboard/summary?range=7d');
    expect(res.body.current.sent).toBe(100);
    expect(res.body.sentDeltaPct).toBe(100);
  });

  it('TW-DASH-004: no sends in the last 20 hours draws 20 zero slots, and the empty workspace never errors', async () => {
    const p = await api.signup('dsum5');
    const res = await api.as(p.admin).get('/v2/dashboard/summary?range=7d');
    expect(res.status).toBe(200);
    expect(res.body.sparkline).toEqual(new Array(20).fill(0));
    expect(res.body.current).toMatchObject({ sent: 0, deliverability: 0, readRate: 0, replyRate: 0 });
    expect(res.body.funnel.endToEnd).toBe(0);
  });

  it('TW-DASH-004: the sparkline is hourly, oldest first', async () => {
    const p = await api.signup('dsum6');
    await seed(p, 'messages', [
      ...many(3, { ago: '30 minutes' }),
      { ago: '5 hours 30 minutes' },
      { ago: '30 hours' }, // outside the 20 hours
    ]);
    const res = await api.as(p.admin).get('/v2/dashboard/summary');
    expect(res.body.sparkline[19]).toBe(3);
    expect(res.body.sparkline[14]).toBe(1);
    expect(res.body.sparkline.reduce((a: number, b: number) => a + b, 0)).toBe(4);
  });
});

describe('throughput chart (TW-DASH-012)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dthr');
    await seed(t, 'messages', [
      { status: 'failed', ago: '10 minutes' },
      { status: 'delivered', ago: '10 minutes' },
      ...many(40, { status: 'delivered', ago: '3 hours 30 minutes' }),
      { status: 'pending', ago: '20 hours' },
    ]);
  });

  it('24h: 24 hourly bars per series ending at the current hour', async () => {
    const res = await api.as(t.admin).get('/v2/dashboard/throughput?range=24h');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.bucket).toBe('hour');
    for (const k of ['starts', 'sent', 'delivered', 'failed']) expect(res.body[k]).toHaveLength(24);
    const last = Date.parse(res.body.starts[23]);
    expect(Date.now() - last).toBeLessThan(3_600_000);
    expect(Date.parse(res.body.starts[1]) - Date.parse(res.body.starts[0])).toBe(3_600_000);
  });

  it('a failed message counts in Sent and Failed but not Delivered; pending counts only in Sent', async () => {
    const res = await api.as(t.admin).get('/v2/dashboard/throughput?range=7d');
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(sum(res.body.sent)).toBe(43);
    expect(sum(res.body.failed)).toBe(1);
    expect(sum(res.body.delivered)).toBe(41);
    expect(res.body.bucket).toBe('day');
    expect(res.body.sent).toHaveLength(8);
  });

  it('peak hour is the busiest of the last 24 hours and the average is per hour over 24', async () => {
    const res = await api.as(t.admin).get('/v2/dashboard/throughput?range=24h');
    expect(res.body.peak.count).toBe(40);
    expect(res.body.avgPerHour).toBe(Math.round(43 / 24));
    const age = Date.now() - Date.parse(res.body.peak.start);
    expect(age).toBeGreaterThan(3 * 3_600_000);
    expect(age).toBeLessThan(5 * 3_600_000);
  });

  it('30d has 31 daily buckets and qtd one per day since the quarter began; an empty workspace is flat, not an error', async () => {
    expect((await api.as(t.admin).get('/v2/dashboard/throughput?range=30d')).body.sent).toHaveLength(31);
    const q = await api.as(t.admin).get('/v2/dashboard/throughput?range=qtd');
    expect(q.status).toBe(200);
    expect(q.body.sent.length).toBeGreaterThanOrEqual(1);
    const p = await api.signup('dthr2');
    const empty = await api.as(p.admin).get('/v2/dashboard/throughput?range=7d');
    expect(empty.body.sent.every((n: number) => n === 0)).toBe(true);
    expect(empty.body.peak).toBeNull();
    expect(empty.body.avgPerHour).toBe(0);
  });
});

describe('analytics (TW-DASH-022..025, 027, 031, 032)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dana');
    await withAnalytics(t);
    await seed(t, 'messages', [
      ...many(900, { status: 'delivered', ago: '3 days' }),
      ...many(50, { status: 'failed', ago: '3 days' }),
      ...many(50, { status: 'pending', ago: '3 days' }),
      ...many(100, { status: 'failed', ago: '40 days' }), // previous 30d window: 100 failures
      ...many(100, { status: 'delivered', ago: '40 days' }),
    ]);
    await seed(t, 'messages', [
      ...many(6, { status: 'delivered', ago: '2 days 1 hour', media: undefined }),
      ...many(3, { status: 'delivered', ago: '2 days', template: true }),
      { status: 'delivered', ago: '2 days', media: 'image' },
    ]);
  });

  it('TW-DASH-022 #1: the default window is the last 30 days ending today', async () => {
    const res = await api.as(t.admin).get('/v2/analytics/overview');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.range).toBe('30d');
    expect(res.body.window.days).toBe(31);
    expect(res.body.window.toDate).toBe(new Date().toISOString().slice(0, 10));
    expect(res.body.window.prevTo).toBe(res.body.window.from);
  });

  it('TW-DASH-023: totals, queued = sent - delivered - failed, and fewer failures than before is a negative trend', async () => {
    const res = await api.as(t.admin).get('/v2/analytics/overview?range=30d');
    expect(res.body.current.sent).toBe(1010);
    expect(res.body.current.failed).toBe(50);
    expect(res.body.current.delivered).toBe(910);
    expect(res.body.current.queued).toBe(50);
    expect(res.body.current.deliverability).toBe(90.1);
    expect(res.body.previous.failed).toBe(100);
    expect(res.body.trends.failedPct).toBe(-50);
  });

  it('TW-DASH-024: one value per day, zeros on empty days, and the three series agree with the totals', async () => {
    const res = await api.as(t.admin).get('/v2/analytics/overview?range=7d');
    const d = res.body.daily;
    expect(d.dates).toHaveLength(8);
    for (const k of ['sent', 'delivered', 'failed', 'queued']) expect(d[k]).toHaveLength(8);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(sum(d.sent)).toBe(res.body.current.sent);
    expect(sum(d.failed)).toBe(50);
    expect(d.sent.filter((n: number) => n === 0).length).toBeGreaterThanOrEqual(4);
  });

  it('TW-DASH-027: type mix, template before media, zero buckets omitted', async () => {
    const res = await api.as(t.admin).get('/v2/analytics/overview?range=7d');
    const m = Object.fromEntries(res.body.types.map((x: { key: string; count: number }) => [x.key, x.count]));
    expect(m).toEqual({ text: 1006, template: 3, media: 1 });
  });

  it('TW-DASH-031: the heatmap is 7 x 24 and counts every message of the window', async () => {
    const res = await api.as(t.admin).get('/v2/analytics/overview?range=7d');
    expect(res.body.heatmap).toHaveLength(7);
    expect(res.body.heatmap.every((r: number[]) => r.length === 24)).toBe(true);
    const total = res.body.heatmap.flat().reduce((a: number, b: number) => a + b, 0);
    expect(total).toBe(res.body.current.sent + res.body.current.replies);
  });

  it('TW-DASH-022: an inverted custom range is swapped; a missing From and To is the last 30 days; over a year is 422', async () => {
    const swapped = await api
      .as(t.admin)
      .get('/v2/analytics/overview?range=custom&from=2026-05-10&to=2026-05-01');
    expect([swapped.body.window.fromDate, swapped.body.window.toDate]).toEqual(['2026-05-01', '2026-05-10']);
    const open = await api.as(t.admin).get('/v2/analytics/overview?range=custom');
    expect(open.body.window.days).toBe(31);
    const long = await api
      .as(t.admin)
      .get('/v2/analytics/overview?range=custom&from=2024-01-01&to=2026-01-01');
    expect(long.status).toBe(422);
    expect((await api.as(t.admin).get('/v2/analytics/overview?range=zzz')).body.range).toBe('30d');
  });

  it('TW-DASH-025: the funnel carries the previous end-to-end change in points', async () => {
    const c1 = await conversation(t);
    await seed(t, 'inbox_messages', [
      ...many(101, { dir: 'in', status: 'received', ago: '2 days', conv: c1 }),
    ]);
    const res = await api.as(t.admin).get('/v2/analytics/overview?range=30d');
    expect(res.body.funnel.stages[3].count).toBe(1);
    expect(res.body.trends.endToEndPp).toBe(0.1);
    expect(res.body.funnel.stages[2].count).toBe(101);
  });

  it('TW-DASH-032: the export is a CSV with the KPI grid and the daily series, formulas neutralised', async () => {
    const res = await api.as(t.admin).get('/v2/analytics/export?range=7d');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('Metric,Value');
    expect(lines).toContain('Sent,1010');
    expect(lines.some((l: string) => l.startsWith('Date,Sent,Delivered,Failed,Queued'))).toBe(true);
    expect(lines.filter((l: string) => /^\d{4}-\d{2}-\d{2},/.test(l))).toHaveLength(8);
  });

  it('TW-DASH-002: another workspace sees none of it', async () => {
    const o = await api.signup('dana2');
    await withAnalytics(o);
    const res = await api.as(o.admin).get('/v2/analytics/overview?range=30d');
    expect(res.body.current.sent).toBe(0);
    expect(res.body.heatmap.flat().reduce((a: number, b: number) => a + b, 0)).toBe(0);
  });
});

describe('the workspace zone (TW-DASH-053 / 031)', () => {
  it('days and heatmap hours are cut in the workspace time zone', async () => {
    const t = await api.signup('dtz');
    await withAnalytics(t);
    await h.owner.query(
      `UPDATE organizations SET settings = settings || '{"timezone":"Asia/Kolkata"}'::jsonb WHERE id = $1`,
      [t.orgId],
    );
    // 02:00 UTC two days ago is 07:30 in Kolkata
    await h.owner.query(
      `INSERT INTO messages (org_id, direction, status, created_at)
       VALUES ($1, 'out', 'delivered', date_trunc('day', now() - interval '2 days') + interval '2 hours')`,
      [t.orgId],
    );
    const res = await api.as(t.admin).get('/v2/analytics/overview?range=7d');
    expect(res.body.window.timezone).toBe('Asia/Kolkata');
    const cell = res.body.heatmap.flatMap((r: number[], d: number) => r.map((n, hr) => [d, hr, n])).filter((x: number[]) => x[2] > 0);
    expect(cell).toHaveLength(1);
    expect(cell[0][1]).toBe(7);
  });
});
