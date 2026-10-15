import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simInbound } from '../chat-conversations/pipeline-support';
import {
  addFlow,
  graph,
  node,
  openChannel,
  startFlowPipeline,
  until,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from '../flow-runtime-engine/support';
import { VALID } from './fixtures';

/**
 * Chat messages (QA task 14): what a customer writes is stored as written, a flow can echo it back, and what the customer is sent
 * is the same text, byte for byte. One catch-all flow replies with the customer's own words, so inbound storage, the flow's variables
 * and the outbound send are all exercised by one message.
 */
let p: FlowPipeline;
let t: Tenant;
let ch: SimChannel;
beforeAll(async () => {
  p = await startFlowPipeline();
  t = await p.api.signup('unicodechat');
  ch = await openChannel(p, t);
  await addFlow(p, t, {
    graph: graph([node('a', 'message', { text: '{{user_message}}' })], []),
    trigger: { kind: 'keyword', keywords: 'any' },
  });
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

let counter = 0;
describe('a customer writes it, the flow echoes it', () => {
  it.each(VALID.map((s) => [s.id, s] as const))('%s', async (_id, s) => {
    const peer = `9198${String(50000000 + counter++).padStart(8, '0')}`;
    await simInbound(p, t, ch, { from: peer, name: 'Unicode', text: s.text });

    const stored = await until(`inbound message from ${peer}`, async () => {
      const r = await p.h.owner.query(
        `SELECT m.body FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
          WHERE c.org_id = $1 AND c.peer_key = $2 AND m.direction = 'in'`,
        [t.orgId, peer],
      );
      return r.rows.length > 0 ? r.rows.map((x) => x.body as string) : undefined;
    });
    expect(stored).toEqual([s.text]);

    const sent = await untilSent(p, t, ch, peer, 1);
    expect(sent).toEqual([s.text]);
  });
});
