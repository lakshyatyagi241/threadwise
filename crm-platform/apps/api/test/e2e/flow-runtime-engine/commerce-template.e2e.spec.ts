import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fundWallet } from '../../support/fund-wallet';
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
    // A template is a paid message: the workspace's wallet pays for it.
    await fundWallet(p.h.app, t.orgId);
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

  it('a question after a template reaches the customer after it, in the thread order', async () => {
    const ch = await simChannel(p as never, t);
    const tpl = await addTemplate(p, t, {
      name: 'welcome_first',
      body: 'Welcome to Acme.',
    });
    await addFlow(p, t, {
      graph: graph(
        [
          node('t', 'trigger', {}, { isStart: true }),
          node('tp', 'template', { tpl: 'welcome_first', tplId: tpl.id }),
          node('q', 'ask', { prompt: 'What is your name?', var: 'who', validate: 'text' }),
        ],
        [edge('t', 'tp'), edge('tp', 'q')],
      ),
      trigger: { kind: 'keyword', keywords: 'tplask' },
    });
    const peer = nextPeer();
    await simInbound(p, t, ch, { from: peer, name: 'Asha', text: 'tplask' });
    // The thread (and so the inbox) holds them in the order the nodes ran: the template first, then the question.
    expect(await untilSent(p, t, ch, peer, 2)).toEqual(['Welcome to Acme.', 'What is your name?']);
  });

  it('opens a conversation outside the 24 hour window, where a plain message is refused', async () => {
    // Its own workspace: an enrolment writes through the workspace's one sender.
    t = await p.api.signup('flrtplw');
    // A template is a paid message: the workspace's wallet pays for it.
    await fundWallet(p.h.app, t.orgId);
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

  it('leaves by the status exit the provider reports: delivered, read, or the customer replying', async () => {
    const w = await p.api.signup('flrtplst');
    // A template is a paid message: the workspace's wallet pays for it.
    await fundWallet(p.h.app, w.orgId);
    const ch = await simChannel(p as never, w, {
      simulator: { latencyMs: { sent: 0, delivered: 200, read: 700 } },
    });
    const tpl = await addTemplate(p, w, { name: 'status_probe', body: 'Status probe.' });
    const make = async (keyword: string, exits: string[]) =>
      addFlow(p, w, {
        graph: graph(
          [
            node('t', 'trigger', {}, { isStart: true }),
            node('tp', 'template', { tpl: 'status_probe', tplId: tpl.id, statusExits: true }),
            ...exits.map((x) => node(`on_${x}`, 'message', { text: `via ${x}` })),
          ],
          [edge('t', 'tp'), ...exits.map((x) => edge('tp', `on_${x}`, x))],
        ),
        trigger: { kind: 'keyword', keywords: keyword },
      });
    // Delivered is wired (read too): the run leaves at the first one that happens.
    const fd = await make('probe1', ['delivered', 'read']);
    const peer1 = nextPeer();
    await simInbound(p, w, ch, { from: peer1, name: 'D', text: 'probe1' });
    expect(await untilSent(p, w, ch, peer1, 2)).toEqual(['Status probe.', 'via delivered']);
    await untilRun(p, w, fd.id, 'completed', (r) => r.status === 'completed');
    // Only Read is wired: the run waits through "delivered" and leaves at "read".
    const fr = await make('probe2', ['read']);
    const peer2 = nextPeer();
    await simInbound(p, w, ch, { from: peer2, name: 'R', text: 'probe2' });
    expect(await untilSent(p, w, ch, peer2, 2)).toEqual(['Status probe.', 'via read']);
    await untilRun(p, w, fr.id, 'completed', (r) => r.status === 'completed');
    // Only Replied is wired: the receipts change nothing; the customer's next message takes the exit.
    const fp = await make('probe3', ['replied']);
    const peer3 = nextPeer();
    await simInbound(p, w, ch, { from: peer3, name: 'P', text: 'probe3' });
    await untilSent(p, w, ch, peer3, 1);
    await untilRun(p, w, fp.id, 'still waiting', (r) => r.status === 'waiting');
    await simInbound(p, w, ch, { from: peer3, name: 'P', text: 'yes please' });
    expect(await untilSent(p, w, ch, peer3, 2)).toEqual(['Status probe.', 'via replied']);
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
