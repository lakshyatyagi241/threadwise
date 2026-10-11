import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simInbound } from '../chat-conversations/pipeline-support';
import {
  addFlow,
  edge,
  graph,
  node,
  runsOf,
  simChannel,
  startFlowPipeline,
  untilRun,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from './support';

let p: FlowPipeline;
beforeAll(async () => {
  p = await startFlowPipeline();
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

let counter = 0;
const nextPeer = () => `9197${String(70000000 + counter++).padStart(8, '0')}`;
const say = (t: Tenant, ch: SimChannel, peer: string, text: string) =>
  simInbound(p, t, ch, { from: peer, name: 'Asha', text });

const threeNodes = () =>
  graph(
    [
      node('t', 'trigger', {}, { isStart: true }),
      node('a', 'message', { label: 'Greeting', text: 'Hello there' }),
      node('b', 'message', { label: 'Hours', text: 'We are open 9 to 5.' }),
      node('z', 'end'),
    ],
    [edge('t', 'a'), edge('a', 'b'), edge('b', 'z')],
  );

describe('the run log', () => {
  let t: Tenant;
  let ch: SimChannel;
  let flow: { id: number; uuid: string };
  let runUuid: string;
  beforeAll(async () => {
    t = await p.api.signup('flrlog');
    ch = await simChannel(p as never, t);
    flow = await addFlow(p, t, {
      graph: threeNodes(),
      trigger: { kind: 'keyword', keywords: 'log' },
    });
    const peer = nextPeer();
    await say(t, ch, peer, 'log');
    await untilSent(p, t, ch, peer, 2);
    const run = await untilRun(p, t, flow.id, 'completed', (r) => r.status === 'completed');
    runUuid = run.uuid;
  });

  it('logs every node with its label, outcome, exit and time, and keeps totals on the run', async () => {
    const res = await p.api.as(t.admin).get(`/v2/flow-runtime/runs/${runUuid}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const labelled = res.body.log.filter((s: { nodeLabel: string | null }) => s.nodeLabel);
    expect(labelled.map((s: { nodeLabel: string }) => s.nodeLabel)).toEqual(
      expect.arrayContaining(['Greeting', 'Hours']),
    );
    const greeting = res.body.log.find((s: { nodeId: string }) => s.nodeId === 'a');
    expect(greeting).toMatchObject({ outcome: 'ok', port: 1, attempt: 1 });
    // The first row says why the run started.
    expect(res.body.log[0]).toMatchObject({ event: 'start', nodeId: null, outcome: 'ok' });
    expect(res.body.log[0].summary).toContain('keyword');
    expect(typeof greeting.durationMs).toBe('number');
    expect(res.body.nodeCount).toBeGreaterThanOrEqual(3);
    expect(res.body.errorCount).toBe(0);
    expect(res.body.graph.nodes.map((n: { id: string }) => n.id)).toEqual(
      expect.arrayContaining(['a', 'b', 'z']),
    );
    expect(res.body.flowChanged).toBe(false);
  });

  it('stores the graph once per version, not once per run', async () => {
    const peer = nextPeer();
    await say(t, ch, peer, 'log');
    await untilRun(p, t, flow.id, 'second', (r) => r.peer_key === peer && r.status === 'completed');
    const runs = await runsOf(p, t, flow.id);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const rows = await p.h.owner.query(
      `SELECT graph IS NULL AS shared, graph_version_id FROM flow_runs WHERE org_id = $1 AND flow_id = $2`,
      [t.orgId, flow.id],
    );
    expect(rows.rows.every((r) => r.shared && r.graph_version_id !== null)).toBe(true);
    expect(new Set(rows.rows.map((r) => String(r.graph_version_id))).size).toBe(1);
    const versions = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM flow_graph_versions WHERE org_id = $1 AND flow_id = $2`,
      [t.orgId, flow.id],
    );
    expect(versions.rows[0].n).toBe(1);
  });

  it('still shows the run as it happened after the flow is edited', async () => {
    // The user rewords the first node and deletes the second.
    const edited = graph(
      [
        node('t', 'trigger', {}, { isStart: true }),
        node('a', 'message', { label: 'Greeting v2', text: 'Hi!' }),
        node('z', 'end'),
      ],
      [edge('t', 'a'), edge('a', 'z')],
    );
    await p.h.owner.query(`UPDATE flows SET flow_data = $1::jsonb WHERE org_id = $2 AND id = $3`, [
      JSON.stringify(edited),
      t.orgId,
      flow.id,
    ]);
    const res = await p.api.as(t.admin).get(`/v2/flow-runtime/runs/${runUuid}`);
    expect(res.body.flowChanged).toBe(true);
    expect(res.body.removedNodeIds).toEqual(['b']);
    // The log keeps what the node was, and the path is still the old one.
    const hours = res.body.log.find((s: { nodeId: string }) => s.nodeId === 'b');
    expect(hours.nodeLabel).toBe('Hours');
    expect(res.body.graph.nodes.map((n: { id: string }) => n.id)).toContain('b');
    // A new run walks the new version: a second stored graph.
    const peer = nextPeer();
    await say(t, ch, peer, 'log');
    await untilRun(p, t, flow.id, 'third', (r) => r.peer_key === peer && r.status === 'completed');
    const versions = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM flow_graph_versions WHERE org_id = $1 AND flow_id = $2`,
      [t.orgId, flow.id],
    );
    expect(versions.rows[0].n).toBe(2);
  });

  it('deletes runs, their steps and unused graph versions 30 days after they end, and nothing else', async () => {
    const before = await runsOf(p, t, flow.id);
    const oldRun = before[0]!;
    await p.h.owner.query(
      `UPDATE flow_runs SET ended_at = now() - interval '31 days' WHERE org_id = $1 AND id = $2`,
      [t.orgId, oldRun.id],
    );
    // A live run, however old, is never swept.
    const { FlowRunRetentionService } =
      await import('../../../src/modules/flow-runtime-engine/runtime/flow-run-retention.service');
    const out = await p.h.app.get(FlowRunRetentionService).sweep();
    expect(out.runs).toBeGreaterThanOrEqual(1);
    const left = await runsOf(p, t, flow.id);
    expect(left.map((r) => r.id)).not.toContain(oldRun.id);
    expect(left.length).toBe(before.length - 1);
    const steps = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM flow_run_steps WHERE org_id = $1 AND run_id = $2`,
      [t.orgId, oldRun.id],
    );
    expect(steps.rows[0].n).toBe(0);
    const gone = await p.api.as(t.admin).get(`/v2/flow-runtime/runs/${oldRun.uuid}`);
    expect(gone.status).toBe(404);
  });
});
