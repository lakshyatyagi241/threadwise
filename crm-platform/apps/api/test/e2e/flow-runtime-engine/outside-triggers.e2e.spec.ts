import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addFlow,
  graph,
  node,
  openChannel,
  runsOf,
  startFlowPipeline,
  untilSent,
  type FlowPipeline,
  type Tenant,
} from './support';

let p: FlowPipeline;
beforeAll(async () => {
  p = await startFlowPipeline();
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

const msg = (text: string) => graph([node('a', 'message', { text })], []);
const bearer = (t: Tenant) => ({ Authorization: `Bearer ${t.admin}` });

const hookInfo = async (t: Tenant, uuid: string) => {
  const res = await p.api.http().get(`/v2/flow-runtime/flows/${uuid}/webhook`).set(bearer(t));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { path: string; url: string | null; live: boolean };
};

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  p.api
    .http()
    .post(path)
    .set('content-type', 'application/json')
    .set(headers)
    .send(typeof body === 'string' ? body : JSON.stringify(body));

describe('the Webhook trigger', () => {
  it('starts a published flow for the contact the body names, creating it, and sets the fields as variables', async () => {
    const t = await p.api.signup('hookok');
    const ch = await openChannel(p, t);
    const f = await addFlow(p, t, {
      graph: msg('Hi {{name}}, order {{order_id}} is on its way'),
      trigger: { kind: 'webhook', value: 0 },
    });
    const info = await hookInfo(t, f.uuid);
    expect(info.live).toBe(true);
    expect(info.path).toMatch(new RegExp(`^/v2/public/flow-hooks/${f.uuid}/[A-Za-z0-9_-]{43}$`));

    const first = await post(info.path, { phone: '+919811300001', name: 'Asha', order_id: 'A-17' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toEqual({ ok: true, status: 'started' });
    expect(await untilSent(p, t, ch, '919811300001', 1)).toEqual([
      'Hi Asha, order A-17 is on its way',
    ]);
    const made = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND normalized_phone = '+919811300001'`,
      [t.orgId],
    );
    expect(made.rows[0].n).toBe(1);

    // The same post again (a sender's retry) is acknowledged and starts nothing; a new delivery id for the same person runs again.
    const retry = await post(info.path, { phone: '+919811300001', name: 'Asha', order_id: 'A-17' });
    expect(retry.body).toEqual({ ok: true, status: 'duplicate' });
    const next = await post(
      info.path,
      { phone: '+919811300001', name: 'Asha', order_id: 'A-18' },
      { 'Idempotency-Key': 'delivery-2' },
    );
    expect(next.body.status).toBe('started');
    expect(await untilSent(p, t, ch, '919811300001', 2)).toContain(
      'Hi Asha, order A-18 is on its way',
    );
    expect((await runsOf(p, t, f.id)).length).toBe(2);
  });

  it('answers the same 404 for a wrong token, an unknown flow, a draft flow and another trigger, and says what is wrong with a good one', async () => {
    const t = await p.api.signup('hook404');
    const live = await addFlow(p, t, { graph: msg('x'), trigger: { kind: 'webhook', value: 0 } });
    const draft = await addFlow(p, t, {
      graph: msg('x'),
      trigger: { kind: 'webhook', value: 0 },
      published: false,
    });
    const other = await addFlow(p, t, { graph: msg('x'), trigger: { kind: 'opt_in', value: 0 } });
    const good = (await hookInfo(t, live.uuid)).path;
    const token = good.split('/').pop()!;
    const body = { phone: '+919811300002' };

    const refused = [
      good.replace(token, 'x'.repeat(43)),
      `/v2/public/flow-hooks/00000000-0000-4000-8000-000000000000/${token}`,
      `/v2/public/flow-hooks/${draft.uuid}/${(await hookInfo(t, draft.uuid)).path.split('/').pop()}`,
      `/v2/public/flow-hooks/${other.uuid}/${(await hookInfo(t, other.uuid)).path.split('/').pop()}`,
      `/v2/public/flow-hooks/not-a-uuid/${token}`,
    ];
    const answers = await Promise.all(refused.map((path) => post(path, body)));
    for (const a of answers) expect(a.status).toBe(404);
    expect(
      new Set(
        answers.map((a) =>
          JSON.stringify({
            ...a.body,
            instance: undefined,
            requestId: undefined,
            traceId: undefined,
          }),
        ),
      ).size,
    ).toBe(1);

    expect((await post(good, 'not json')).status).toBe(400);
    expect((await post(good, [1, 2])).status).toBe(400);
    const nobody = await post(good, { order_id: 'A-1' });
    expect(nobody.status).toBe(422);
    const big = await post(good, { phone: '+919811300002', note: 'x'.repeat(70_000) });
    expect(big.status).toBe(413);
  });

  it("is another workspace's 404 when staff of one ask for the address of the other's flow", async () => {
    const a = await p.api.signup('hooka');
    const b = await p.api.signup('hookb');
    const f = await addFlow(p, a, { graph: msg('x'), trigger: { kind: 'webhook', value: 0 } });
    const res = await p.api.http().get(`/v2/flow-runtime/flows/${f.uuid}/webhook`).set(bearer(b));
    expect(res.status).toBe(404);
  });
});

describe('the Webhook trigger rate limit', () => {
  it('limits one address to 120 posts a minute and answers 429 with Retry-After', async () => {
    const path = '/v2/public/flow-hooks/00000000-0000-4000-8000-000000000001/' + 'z'.repeat(43);
    const statuses: number[] = [];
    let retryAfter: string | undefined;
    for (let i = 0; i < 125; i++) {
      const res = await post(path, {}, { 'x-forwarded-for': '203.0.113.77' });
      statuses.push(res.status);
      if (res.status === 429) retryAfter ??= res.headers['retry-after'];
    }
    const first429 = statuses.indexOf(429) + 1;
    console.log(
      'FLOW-HOOK-CENSUS',
      JSON.stringify({ first429, retryAfter, notFound: statuses.filter((s) => s === 404).length }),
    );
    expect(first429).toBe(121);
    expect(retryAfter).toBeDefined();
  });
});

describe('the Google Sheet trigger', () => {
  it('starts the flow for each new row, never for the rows there when it was turned on, and starts over when turned off and on', async () => {
    const t = await p.api.signup('sheet');
    const ch = await openChannel(p, t);
    const f = await addFlow(p, t, {
      graph: msg('Hello {{name}}, we got your request about {{topic}}'),
      trigger: { kind: 'google_sheet', value: 0 },
    });
    await p.h.owner.query(
      `UPDATE flows SET trigger_config = $3::jsonb WHERE org_id = $1 AND id = $2`,
      [
        t.orgId,
        f.id,
        JSON.stringify({
          sheetId: 'sheet-1',
          tabName: 'Leads',
          phoneColumn: 'Mobile',
          intervalMinutes: 2,
        }),
      ],
    );
    const { GOOGLE_WORKSPACE } =
      await import('../../../src/infra/providers/flow-runtime-engine/google-workspace.port');
    const { SheetTriggerSweeper } =
      await import('../../../src/modules/flow-runtime-engine/triggers/sheet-trigger.sweeper');
    const google = p.h.app.get(GOOGLE_WORKSPACE, { strict: false });
    const sweep = p.h.app.get(SheetTriggerSweeper);
    let grid: string[][] = [
      ['Name', 'Mobile', 'Topic'],
      ['Old One', '+919811400001', 'old'],
      ['Old Two', '+919811400002', 'old'],
    ];
    google.readSheetGrid = async () => grid.map((r) => [...r]);
    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    // Turned on over a sheet that already holds rows: only the size is recorded.
    expect((await sweep.tickOnce()).get(f.id)).toBe('baseline');
    grid = [...grid, ['Meera', '+919811400003', 'pricing']];
    // Not due yet (the flow asked for two minutes).
    expect((await sweep.tickOnce(later(1))).get(f.id)).toBe('skipped');
    expect((await sweep.tickOnce(later(3))).get(f.id)).toBe('started');
    expect(await untilSent(p, t, ch, '919811400003', 1)).toEqual([
      'Hello Meera, we got your request about pricing',
    ]);
    // The same rows are not run twice.
    expect((await sweep.tickOnce(later(6))).get(f.id)).toBe('idle');
    expect((await runsOf(p, t, f.id)).length).toBe(1);
    const old = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND normalized_phone IN ('+919811400001','+919811400002')`,
      [t.orgId],
    );
    expect(old.rows[0].n).toBe(0);

    // A row nobody can be found for is passed over, and the one after it still runs.
    grid = [...grid, ['No Number', '', 'x'], ['Ravi', '+919811400004', 'demo']];
    expect((await sweep.tickOnce(later(9))).get(f.id)).toBe('started');
    expect(await untilSent(p, t, ch, '919811400004', 1)).toEqual([
      'Hello Ravi, we got your request about demo',
    ]);

    // Turned off, a row is added, turned on: it is part of the sheet as it is now, not a new row.
    await p.h.owner.query(`UPDATE flows SET is_active = false WHERE org_id = $1 AND id = $2`, [
      t.orgId,
      f.id,
    ]);
    await sweep.tickOnce(later(12));
    const kept = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM flow_sheet_cursor WHERE org_id = $1`,
      [t.orgId],
    );
    expect(kept.rows[0].n).toBe(0);
    grid = [...grid, ['While Off', '+919811400005', 'off']];
    await p.h.owner.query(`UPDATE flows SET is_active = true WHERE org_id = $1 AND id = $2`, [
      t.orgId,
      f.id,
    ]);
    expect((await sweep.tickOnce(later(15))).get(f.id)).toBe('baseline');
    expect((await runsOf(p, t, f.id)).length).toBe(2);
  });
});
