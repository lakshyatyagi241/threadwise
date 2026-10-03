import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addFlow,
  graph,
  node,
  openChannel,
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

const NO_SENDER = 'No connected simulator sender for this workspace';

/** The read side of the analytics screens: execution history, error logs, retry records and retry by ids (WD-FLR-053 to 058). */
describe('execution history, error logs, retry records and retry by ids', () => {
  let t: Tenant;
  let flowUuid: string;
  let subs: string[];
  let contacts: string[];

  beforeAll(async () => {
    t = await p.api.signup('flrread');
    const f = await addFlow(p, t, {
      name: 'Welcome flow',
      graph: graph([node('a', 'message', { text: 'hello {{name}}' })], []),
      trigger: { kind: 'manual_enroll' },
    });
    flowUuid = f.uuid;
    contacts = await p.api.seedContacts(t, [
      { name: 'Asha Verma', phone: '+919811200001' },
      { name: 'Bala Iyer', phone: '+919811200002' },
      { name: 'Chitra Nair', phone: '+919811200003' },
    ]);
    // No channel yet: every launch fails before a run exists, which WaDesk still shows as a failed run.
    const res = await p.api
      .as(t.admin)
      .post(`/v2/flow-runtime/flows/${flowUuid}/enroll`)
      .send({ contactIds: contacts });
    expect(res.body).toMatchObject({ enrolled: 0, failed: 3 });
    const list = await p.api.as(t.admin).get(`/v2/flow-runtime/flows/${flowUuid}/subscribers`);
    subs = list.body.items.map((i: { id: string }) => i.id);
  });

  const get = (path: string) => p.api.as(t.admin).get(`/v2/flow-runtime/${path}`);

  it('lists every pass through a flow with status counts, and a failed row can be retried', async () => {
    const res = await get('history');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.counts).toEqual({ all: 3, active: 0, paused: 0, completed: 0, failed: 3 });
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0]).toMatchObject({
      flowName: 'Welcome flow',
      flowState: 'live',
      status: 'failed',
      failureReason: NO_SENDER,
      canRetry: true,
      retryCount: 0,
      durationSeconds: null,
      lastRunId: null,
    });
  });

  it('filters by status, search, flow and dates, and the counts ignore the status filter', async () => {
    const failed = await get('history?status=completed');
    expect(failed.body.items).toHaveLength(0);
    expect(failed.body.counts.failed).toBe(3);

    const byName = await get('history?q=bala');
    expect(byName.body.items).toHaveLength(1);
    expect(byName.body.items[0].contact.name).toBe('Bala Iyer');
    expect((await get('history?q=sender')).body.items).toHaveLength(3);
    expect((await get('history?q=welcome')).body.items).toHaveLength(3);
    expect((await get('history?q=%25')).body.items).toHaveLength(0);
    expect((await get('history?q=nobody-here')).body.counts.all).toBe(0);

    expect((await get(`history?flowId=${flowUuid}`)).body.items).toHaveLength(3);
    expect((await get(`history?flowId=${randomUUID()}`)).body.items).toHaveLength(0);

    expect((await get('history?days=7')).body.items).toHaveLength(3);
    expect((await get('history?dateFrom=2999-01-01')).body.items).toHaveLength(0);
    expect((await get('history?dateTo=2000-01-01')).body.items).toHaveLength(0);
    expect((await get('history?days=7&dateTo=2000-01-01')).body.items).toHaveLength(0);
    expect((await get('history?dateFrom=nope')).status).toBe(422);
  });

  it('pages with a cursor', async () => {
    const first = await get('history?limit=2');
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await get(`history?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const ids = [...first.body.items, ...second.body.items].map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('groups failures by reason with the flows hit and the subscribers behind it', async () => {
    const res = await get('errors');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.totals).toEqual({
      failed: 3,
      distinctReasons: 1,
      affectedFlows: 1,
      affectedContacts: 3,
      retried: 0,
    });
    const g = res.body.groups[0];
    expect(g).toMatchObject({ reason: NO_SENDER, count: 3 });
    expect(g.flows).toEqual([{ flowId: flowUuid, flowName: 'Welcome flow', count: 3 }]);
    expect([...g.subscriberIds].sort()).toEqual([...subs].sort());
    expect(g.firstSeen).toBeTruthy();
    expect((await get('errors?q=zzz')).body.groups).toEqual([]);
  });

  it('the analytics numbers count a launch that failed before any run', async () => {
    const res = await get('analytics');
    expect(res.body.totals).toMatchObject({ enrolled: 3, failed: 3, completed: 0 });
    expect(res.body.failureReasons[0]).toMatchObject({ reason: NO_SENDER, count: 3 });
    expect(res.body.leaderboard[0]).toMatchObject({
      flowName: 'Welcome flow',
      state: 'live',
      runs: 3,
      failed: 3,
      failureRate: 100,
      completionRate: 0,
    });
    expect(res.body.extras).toMatchObject({
      flowsTotal: 1,
      flowsLive: 1,
      flowsWithRuns: 1,
      retryAttempts: 0,
    });
    const all = await get('analytics?days=0');
    expect(all.body.totals.enrolled).toBe(3);
  });

  it('retries the named runs once a sender exists, logs each attempt, and holds a second press for the cooldown', async () => {
    const ch = await openChannel(p, t);
    const res = await p.api
      .as(t.admin)
      .post('/v2/flow-runtime/retry')
      .send({ subscriberIds: [subs[0], subs[1], randomUUID(), subs[0]] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      requested: 3,
      attempted: 2,
      queued: 2,
      succeeded: 0,
      failed: 0,
      skipped: 1,
    });
    expect(
      res.body.results.filter((r: { reason: string | null }) => r.reason === 'not_found'),
    ).toHaveLength(1);
    await untilSent(p, t, ch, '919811200003', 1);

    const again = await p.api
      .as(t.admin)
      .post('/v2/flow-runtime/retry')
      .send({ subscriberIds: [subs[0], subs[2]] });
    const reasons = Object.fromEntries(
      again.body.results.map(
        (r: { subscriberId: string; outcome: string | null; reason: string | null }) => [
          r.subscriberId,
          r.outcome ?? r.reason,
        ],
      ),
    );
    // subs[0] was just retried and is no longer failed; the cooldown speaks first, as in WaDesk.
    expect(reasons[subs[0]!]).toBe('too_soon');
    expect(reasons[subs[2]!]).toBe('queued');
  });

  it('records every retry with who, what it was before and what came of it', async () => {
    const res = await get('retries');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.totals).toEqual({ all: 3, queued: 3, succeeded: 0, failed: 0, skipped: 0 });
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0]).toMatchObject({
      flowName: 'Welcome flow',
      source: 'manual',
      previousStatus: 'failed',
      previousFailureReason: NO_SENDER,
      outcome: 'queued',
      outcomeReason: null,
    });
    expect(res.body.items[0].retriedBy).toBeTruthy();
    expect(res.body.items[0].contact.name).toBeTruthy();

    const failedOnly = await get('retries?outcome=failed');
    expect(failedOnly.body.items).toEqual([]);
    expect(failedOnly.body.totals.all).toBe(3);
    expect((await get('retries?outcome=queued&limit=2')).body.nextCursor).toBeTruthy();
    expect((await get(`retries?flowId=${randomUUID()}`)).body.totals.all).toBe(0);
    expect((await get('retries?dateFrom=2999-01-01')).body.items).toHaveLength(0);
    expect((await get('history')).body.counts.failed).toBe(0);
    expect((await get('analytics')).body.extras.retryAttempts).toBe(3);
  });

  it('retry of one run says what became of it, and a switched-off flow refuses', async () => {
    const f2 = await addFlow(p, t, {
      name: 'Second flow',
      graph: graph([node('a', 'message', { text: 'x' })], []),
      trigger: { kind: 'manual_enroll' },
    });
    const [cid] = await p.api.seedContacts(t, [{ name: 'Dev Roy', phone: '+919811200004' }]);
    // Close the channel by taking the sender away: the launch fails.
    await p.h.owner.query(`UPDATE channels SET status = 'disconnected' WHERE org_id = $1`, [
      t.orgId,
    ]);
    await p.api
      .as(t.admin)
      .post(`/v2/flow-runtime/flows/${f2.uuid}/enroll`)
      .send({ contactIds: [cid] });
    const sub = (await p.api.as(t.admin).get(`/v2/flow-runtime/flows/${f2.uuid}/subscribers`)).body
      .items[0];
    expect(sub.status).toBe('failed');

    const again = await p.api.as(t.admin).post(`/v2/flow-runtime/subscribers/${sub.id}/retry`);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body).toMatchObject({
      retried: 0,
      skipped: 1,
      outcome: 'failed',
      reason: NO_SENDER,
    });
    const logged = await get('retries?outcome=failed');
    expect(logged.body.items[0]).toMatchObject({ outcome: 'failed', outcomeReason: NO_SENDER });

    await p.h.owner.query(`UPDATE flows SET is_active = false WHERE org_id = $1 AND uuid = $2`, [
      t.orgId,
      f2.uuid,
    ]);
    const off = await p.api.as(t.admin).post(`/v2/flow-runtime/subscribers/${sub.id}/retry`);
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('FLR_FLOW_INACTIVE');
    const hist = await get(`history?flowId=${f2.uuid}`);
    expect(hist.body.items[0]).toMatchObject({
      status: 'failed',
      canRetry: false,
      flowState: 'paused',
    });
  });

  it('caps a batch, needs the manage permission to retry, lets a reader read, and keeps workspaces apart', async () => {
    const tooMany = await p.api
      .as(t.admin)
      .post('/v2/flow-runtime/retry')
      .send({ subscriberIds: Array.from({ length: 51 }, () => randomUUID()) });
    expect(tooMany.status).toBe(422);
    const none = await p.api.as(t.admin).post('/v2/flow-runtime/retry').send({ subscriberIds: [] });
    expect(none.status).toBe(422);

    const reader = await p.api.member(t, 'readerx', [['flr.runs.read']]);
    for (const path of ['history', 'errors', 'retries', 'analytics']) {
      expect((await p.api.as(reader.token).get(`/v2/flow-runtime/${path}`)).status, path).toBe(200);
    }
    const denied = await p.api
      .as(reader.token)
      .post('/v2/flow-runtime/retry')
      .send({ subscriberIds: [subs[0]] });
    expect(denied.status).toBe(403);
    const nothing = await p.api.member(t, 'nobodyx', []);
    expect((await p.api.as(nothing.token).get('/v2/flow-runtime/history')).status).toBe(403);

    const other = await p.api.signup('flrreadother');
    expect((await p.api.as(other.admin).get('/v2/flow-runtime/history')).body.counts.all).toBe(0);
    expect((await p.api.as(other.admin).get('/v2/flow-runtime/errors')).body.groups).toEqual([]);
    expect((await p.api.as(other.admin).get('/v2/flow-runtime/retries')).body.totals.all).toBe(0);
    const foreign = await p.api
      .as(other.admin)
      .post('/v2/flow-runtime/retry')
      .send({ subscriberIds: [subs[0]] });
    expect(foreign.body).toMatchObject({ attempted: 0, skipped: 1 });
    expect(foreign.body.results[0].reason).toBe('not_found');
  });
});
