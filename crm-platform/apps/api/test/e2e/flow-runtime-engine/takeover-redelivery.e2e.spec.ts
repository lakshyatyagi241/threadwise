import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conversationOf, simInbound, until } from '../chat-conversations/pipeline-support';
import {
  addFlow,
  edge,
  graph,
  node,
  runsOf,
  simChannel,
  startFlowPipeline,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from './support';

/**
 * A redelivered `conversation.assigned` event must not stop a flow the customer started after the takeover (#1299). The outbox
 * retries an event that failed, so an old takeover can arrive after the customer has begun a new run. Real API, real Postgres and Redis.
 */
let p: FlowPipeline;
beforeAll(async () => {
  p = await startFlowPipeline();
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

/** Hands the consumer a takeover event exactly as the outbox would, with `assignedAt` as the emitter writes it. */
const takeover = async (t: Tenant, uuid: string, takenOverAt: string) => {
  const { FlowTakeoverConsumer } =
    await import('../../../src/modules/flow-runtime-engine/triggers/takeover.consumer');
  await p.h.app.get(FlowTakeoverConsumer).handle({
    id: `e-${uuid}-${takenOverAt}`,
    orgId: t.orgId,
    aggregateModule: 'team-inbox-routing-sla',
    aggregateId: '1',
    eventType: 'conversation.assigned',
    payload: { conversationId: uuid, toUserId: 'some-user', assignedAt: takenOverAt },
  });
};

describe('a redelivered takeover event ends only the runs it can see (#1299)', () => {
  let t: Tenant;
  let ch: SimChannel;
  beforeAll(async () => {
    t = await p.api.signup('tko');
    ch = await simChannel(p as never, t);
  });

  it('leaves a run started after the takeover alone, and still ends a run started before it', async () => {
    const word = 'tko-redeliver';
    // The flow asks a question and waits for the customer's reply, so the run stays live until something ends it.
    const flow = await addFlow(p, t, {
      graph: graph(
        [
          node('t', 'trigger', {}, { isStart: true }),
          node('m1', 'message', { text: 'Hello from the bot' }),
          node('q', 'ask', { prompt: 'Your email?', var: '{{email_in}}' }),
          node('z', 'end'),
        ],
        [edge('t', 'm1'), edge('m1', 'q'), edge('q', 'z')],
      ),
      trigger: { kind: 'keyword', keywords: word },
      published: true,
    });
    const peer = '919610000001';
    await simInbound(p as never, t, ch, { from: peer, name: 'Asha', text: word });
    await untilSent(p, t, ch, peer, 2);
    const conv = await conversationOf(p as never, t, ch, peer);
    const uuid = String(conv.uuid);

    const [run] = await until('the run waits for the answer', async () => {
      const rs = (await runsOf(p, t, flow.id)).filter(
        (r) => r.peer_key === peer && r.status === 'waiting',
      );
      return rs.length ? rs : null;
    });
    const startedAt = (
      await p.h.owner.query(`SELECT started_at FROM flow_runs WHERE id = $1`, [run!.id])
    ).rows[0]!.started_at as Date;

    // The redelivered copy was taken over an hour before the run started: the run is not touched.
    await takeover(t, uuid, new Date(startedAt.getTime() - 3_600_000).toISOString());
    const after = (await runsOf(p, t, flow.id)).find((r) => r.id === run!.id)!;
    expect(after.status).toBe(run!.status);
    expect(after.end_reason).toBeNull();
    expect(after.status).toBe('waiting');

    // A takeover at or after the start does end it, as before.
    await takeover(t, uuid, new Date(startedAt.getTime() + 1_000).toISOString());
    const ended = (await runsOf(p, t, flow.id)).find((r) => r.id === run!.id)!;
    expect(ended.status).toBe('cancelled');
    expect(ended.end_reason).toBe('takeover');
  }, 120_000);
});
