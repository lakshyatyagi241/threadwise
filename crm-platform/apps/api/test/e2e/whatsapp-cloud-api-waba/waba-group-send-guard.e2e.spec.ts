import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { OutboundService } from '../../../src/modules/chat-conversations/outbound.service';
import { WabaChannelLinkService } from '../../../src/modules/chat-conversations/waba-channel-link.service';
import { graphFixture } from '../../fixtures/whatsapp';
import {
  messagesOf,
  startPipeline,
  until,
  type Pipeline,
} from '../chat-conversations/pipeline-support';

/**
 * WABA_GROUP_SEND_UNAVAILABLE end to end (docs/specs/waba-groups-management.md 4.3, 12.1, phase 0). A WhatsApp group thread is keyed
 * `g:<group id>`; the old path stripped the key to digits and addressed an unrelated phone number. Through the real API, a real
 * Postgres and Redis and the real send worker, with only Meta's Graph faked at the HTTP edge: a manual reply on a group thread is
 * refused (422, typed code), nothing is stored, queued or sent to Meta; a normal thread still sends.
 */
let p: Pipeline;
let calls: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];

beforeAll(async () => {
  p = await startPipeline();
  const fake: FetchLike = async (url, init) => {
    calls.push({
      method: String(init?.method ?? 'GET'),
      url,
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });
    return new Response(JSON.stringify(graphFixture('send-ok')), { status: 200 });
  };
  p.h.app.get(WabaHttp).fetchImpl = fake;
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

let seq = 0;
async function arrange(label: string) {
  const t = await p.api.signup(label);
  const n = seq++;
  const phoneNumberId = `7200${n}00`;
  const row = await p.h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, is_primary, phone_number, display_label, credentials_json, meta_json, connected_at)
     VALUES ($1, 'waba', 'connected', true, $2, 'Support line', $3, $4::jsonb, now()) RETURNING id`,
    [
      t.orgId,
      `+9191144${String(10000 + n)}`,
      p.h.app.get(CryptoService).encrypt(JSON.stringify({ access_token: `EAAG-token-${n}` })),
      JSON.stringify({
        provider: 'meta',
        waba_id: `99${phoneNumberId}`,
        phone_number_id: phoneNumberId,
      }),
    ],
  );
  const channel = await p.h.app
    .get(WabaChannelLinkService, { strict: false })
    .ensure(t.orgId, Number(row.rows[0].id), { create: true });
  if (!channel) throw new Error('no inbox channel was made for the number');
  const thread = async (peer: string, title: string) =>
    (
      await p.h.owner.query(
        `INSERT INTO conversations (org_id, channel_id, peer_key, title, last_inbound_at, window_expires_at)
         VALUES ($1,$2,$3,$4, now(), now() + interval '1 day') RETURNING id, uuid`,
        [t.orgId, channel.id, peer, title],
      )
    ).rows[0] as { id: number | string; uuid: string };
  return { t, channel, thread, phoneNumberId };
}

const GROUP = 'g:Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2';
const reply = (token: string, uuid: string, body: Record<string, unknown>) =>
  p.api.as(token).post(`/v2/inbox/conversations/${uuid}/messages`).send(body);
const text = (body = 'Hello everyone') => ({ kind: 'text', body, clientMessageId: randomUUID() });
const count = async (conversationId: number | string) =>
  Number(
    (
      await p.h.owner.query(`SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1`, [
        conversationId,
      ])
    ).rows[0].n,
  );
const sends = () => calls.filter((c) => c.method === 'POST' && /\/messages$/.test(c.url));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('a manual reply on a WhatsApp group thread (phase 0 send guard)', () => {
  it('is refused with 422 WABA_GROUP_SEND_UNAVAILABLE: nothing is stored, queued or sent to Meta', async () => {
    const x = await arrange('gs1');
    const g = await x.thread(GROUP, 'Neighbours');
    calls = [];

    const res = await reply(x.t.admin, g.uuid, text());
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('WABA_GROUP_SEND_UNAVAILABLE');
    expect(JSON.stringify(res.body)).toMatch(/not available yet/i);

    // Not stored, and (give the worker time) nothing reached the fake Meta.
    expect(await count(g.id)).toBe(0);
    await pause(1_000);
    expect(sends()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  }, 60_000);

  it('a retry of a failed message on a group thread is refused too, and nothing is sent', async () => {
    const x = await arrange('gs3');
    const g = await x.thread(GROUP, 'Neighbours');
    // A message that failed before the guard existed (or arrived any other way) sits on the group thread.
    const m = (
      await p.h.owner.query(
        `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, body, kind, failure_code)
         VALUES ($1,$2,1,'out','agent','failed','old reply','text','RECIPIENT_NOT_ALLOWED') RETURNING uuid`,
        [x.t.orgId, g.id],
      )
    ).rows[0] as { uuid: string };
    await p.h.owner.query(`UPDATE conversations SET msg_seq = 1 WHERE id = $1`, [g.id]);
    calls = [];
    const res = await p.api.as(x.t.admin).post(`/v2/inbox/messages/${m.uuid}/retry`);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('WABA_GROUP_SEND_UNAVAILABLE');
    await pause(800);
    expect(calls).toHaveLength(0);
    const row = (await p.h.owner.query(`SELECT status FROM messages WHERE uuid = $1`, [m.uuid]))
      .rows[0];
    expect(row.status).toBe('failed');
  }, 60_000);

  it('a message already queued on a group thread fails at the worker with the typed code, never calling Meta', async () => {
    const x = await arrange('gs4');
    const g = await x.thread(GROUP, 'Neighbours');
    const m = (
      await p.h.owner.query(
        `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, body, kind, client_message_id)
         VALUES ($1,$2,1,'out','agent','queued','stuck','text',$3) RETURNING uuid`,
        [x.t.orgId, g.id, randomUUID()],
      )
    ).rows[0] as { uuid: string };
    await p.h.owner.query(`UPDATE conversations SET msg_seq = 1 WHERE id = $1`, [g.id]);
    calls = [];
    await p.h.app.get(OutboundService).enqueueJob(x.t.orgId, m.uuid, 1);
    const failed = await until('the message to fail', async () => {
      const r = (
        await p.h.owner.query(`SELECT status, failure_code FROM messages WHERE uuid = $1`, [m.uuid])
      ).rows[0];
      return r?.status === 'failed' ? r : undefined;
    });
    expect(failed.failure_code).toBe('WABA_GROUP_SEND_UNAVAILABLE');
    expect(calls).toHaveLength(0);
  }, 60_000);

  it('group INBOUND is untouched: a message posted in the group is still read from the thread', async () => {
    const x = await arrange('gs5');
    const g = await x.thread(GROUP, 'Neighbours');
    await p.h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, body, kind)
       VALUES ($1,$2,1,'in','customer','received','hi from a member','text')`,
      [x.t.orgId, g.id],
    );
    await p.h.owner.query(`UPDATE conversations SET msg_seq = 1 WHERE id = $1`, [g.id]);
    expect(await messagesOf(p, g.id as number)).toHaveLength(1);
    const read = await p.api.as(x.t.admin).get(`/v2/inbox/conversations/${g.uuid}/messages`);
    expect(read.status).toBe(200);
    expect(read.body.data[0]).toMatchObject({ direction: 'in', body: 'hi from a member' });
  }, 60_000);
});

describe('a normal phone thread on the same number still sends (regression)', () => {
  it('stores the reply, sends it to Meta as an individual to the digits, and leaves the queue', async () => {
    const x = await arrange('gs6');
    const peer = await x.thread('919900000050', 'Asha');
    calls = [];
    const res = await reply(x.t.admin, peer.uuid, text('Your order shipped'));
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const sent = await until('the send to reach Meta', () =>
      sends().length > 0 ? sends() : undefined,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toContain(`/${x.phoneNumberId}/messages`);
    expect(sent[0]!.body).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919900000050',
      type: 'text',
    });
    await until('the message to be sent', async () => {
      const r = (
        await p.h.owner.query(`SELECT status FROM messages WHERE uuid = $1`, [res.body.id])
      ).rows[0];
      return r && r.status !== 'queued' ? r : undefined;
    });
  }, 60_000);
});
