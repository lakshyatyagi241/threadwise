import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simInbound } from '../chat-conversations/pipeline-support';
import { addTemplate, interactiveIn } from './commerce-support';
import {
  addFlow,
  edge,
  graph,
  node,
  simChannel,
  startFlowPipeline,
  untilRun,
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

let counter = 0;
const nextPeer = () => `9197${String(10000000 + counter++).padStart(8, '0')}`;

describe('the Template node (TW-FLR-026)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await p.api.signup('flrtpl');
  });

  it('sends an approved template with the run variables filled in, then moves on', async () => {
    const ch = await simChannel(p as never, t);
    const tpl = await addTemplate(p, t, {
      name: 'order_ready',
      body: 'Hi {{1}}, your order is ready.',
      footer: 'Thanks',
      variableMap: { body: [{ num: 1, key: 'name' }] },
    });
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('t', 'trigger', {}, { isStart: true }),
          node('tp', 'template', { tpl: 'order_ready', tplId: tpl.id }),
          node('m', 'message', { text: 'Anything else?' }),
        ],
        [edge('t', 'tp'), edge('tp', 'm')],
      ),
      trigger: { kind: 'keyword', keywords: 'tplgo' },
    });
    const peer = nextPeer();
    await simInbound(p, t, ch, { from: peer, name: 'Asha', text: 'tplgo' });
    const sent = await untilSent(p, t, ch, peer, 2);
    expect(sent).toEqual(['Hi Asha, your order is ready.\n\n_Thanks_', 'Anything else?']);
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
  });

  it('opens a conversation outside the 24 hour window, where a plain message is refused', async () => {
    // Its own workspace: an enrolment writes through the workspace's one sender.
    t = await p.api.signup('flrtplw');
    const ch = await simChannel(p as never, t, {
      simulator: { latencyMs: { sent: 0, delivered: 150, read: 400 }, window: 'closed' },
    });
    await addTemplate(p, t, { name: 'reopen_chat', body: 'We have news for you.' });
    const f = await addFlow(p, t, {
      graph: graph(
        [node('tp', 'template', { tpl: 'reopen_chat' }), node('m', 'message', { text: 'plain' })],
        [edge('tp', 'm')],
      ),
      trigger: { kind: 'manual_enroll' },
    });
    const [cid] = await p.api.seedContacts(t, [{ name: 'Late', phone: '+919822200001' }]);
    const res = await p.api
      .as(t.admin)
      .post(`/v2/flow-runtime/flows/${f.uuid}/enroll`)
      .send({ contactIds: [cid] });
    expect(res.body).toMatchObject({ enrolled: 1, failed: 0 });
    // The template got through; the free-form message after it was refused by the window and skipped, not fatal.
    expect(await untilSent(p, t, ch, '919822200001', 1)).toEqual(['We have news for you.']);
    const run = await untilRun(p, t, f.id, 'done', (r) => r.status === 'completed');
    expect(run.end_reason).not.toBe('send_failed');
  });

  it('routes the customer tap on a quick reply to its own branch', async () => {
    const ch = await simChannel(p as never, t);
    const tpl = await addTemplate(p, t, {
      name: 'track_or_cancel',
      body: 'Your order shipped.',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Track' },
        { type: 'QUICK_REPLY', text: 'Cancel' },
      ],
    });
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('tp', 'template', { tpl: 'track_or_cancel', tplId: tpl.id, keepMenuOpen: false }),
          node('a', 'message', { text: 'Tracking link on its way' }),
          node('b', 'message', { text: 'Order cancelled' }),
        ],
        [edge('tp', 'a', 'p0'), edge('tp', 'b', 'p1')],
      ),
      trigger: { kind: 'keyword', keywords: 'shipit' },
    });
    const peer = nextPeer();
    await simInbound(p, t, ch, { from: peer, name: 'Ravi', text: 'shipit' });
    await untilSent(p, t, ch, peer, 1);
    await untilRun(p, t, f.id, 'waiting for the tap', (r) => r.status === 'waiting');
    await interactiveIn(p, t, ch, peer, 'Cancel', {
      interactive: { type: 'button', id: null, title: 'Cancel' },
    });
    const sent = await untilSent(p, t, ch, peer, 2);
    expect(sent[1]).toBe('Order cancelled');
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
  });

  it('skips a template that is not approved or not in this workspace, and one of another workspace', async () => {
    const ch = await simChannel(p as never, t);
    await addTemplate(p, t, { name: 'still_pending', body: 'never sent', status: 'pending' });
    const other = await p.api.signup('flrtplo');
    await addTemplate(p, other, { name: 'theirs_only', body: 'secret of the other workspace' });
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('a', 'template', { tpl: 'still_pending' }),
          node('b', 'template', { tpl: 'theirs_only' }),
          node('c', 'template', { tpl: 'does_not_exist' }),
          node('m', 'message', { text: 'only this' }),
        ],
        [edge('a', 'b'), edge('b', 'c'), edge('c', 'm')],
      ),
      trigger: { kind: 'keyword', keywords: 'tplskip' },
    });
    const peer = nextPeer();
    await simInbound(p, t, ch, { from: peer, name: 'Z', text: 'tplskip' });
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['only this']);
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    const log = await p.h.owner.query(
      `SELECT s.detail FROM flow_run_steps s WHERE s.org_id = $1 AND s.run_id IN (SELECT id FROM flow_runs WHERE flow_id = $2)`,
      [t.orgId, f.id],
    );
    expect(JSON.stringify(log.rows)).toContain('not approved');
    expect(JSON.stringify(log.rows)).toContain('not in this workspace');
  });
});
