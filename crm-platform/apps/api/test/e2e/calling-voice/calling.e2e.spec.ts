import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  SDP_ANSWER,
  SDP_OFFER,
  addNumber,
  callRow,
  deliver,
  enableRecording,
  events,
  grantConsentRow,
  metaError,
  startCallPipeline,
  type CallNumber,
  type CallPipeline,
} from './support';

let p: CallPipeline;
beforeAll(async () => {
  p = await startCallPipeline();
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

const CUSTOMER = '919811100001';
let seq = 0;
const metaId = () => `wacid.${Date.now()}${seq++}`;

async function setup(label: string, o: { calling?: boolean; meta?: Record<string, unknown> } = {}) {
  const t = await p.api.signup(label);
  const number = await addNumber(p, t, o);
  p.meta.reset();
  return { t, number };
}

const grant = (
  number: CallNumber,
  phone = CUSTOMER,
  expires = Math.floor(Date.now() / 1000) + 7 * 86400,
) =>
  deliver(p, number, {
    event: 'permission_update',
    from: phone,
    response: 'accept',
    expiration_timestamp: expires,
  });

describe('the calling switch', () => {
  it('lists the numbers and switches calling on after Meta accepts', async () => {
    const { t, number } = await setup('callsw', { calling: false });
    const list = await p.api.as(t.admin).get('/v2/calling/numbers');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.rows).toEqual([
      expect.objectContaining({ id: number.uuid, callingEnabled: false, callingEnabledAt: null }),
    ]);

    const on = await p.api
      .as(t.admin)
      .post(`/v2/calling/numbers/${number.uuid}/toggle`)
      .send({ enable: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.callingEnabled).toBe(true);
    expect(on.body.callingEnabledAt).toBeTruthy();
    expect(p.meta.settings()[0]!.body).toEqual({ calling: { status: 'ENABLED' } });
    expect(p.meta.settings()[0]!.path).toBe(`/${number.phoneNumberId}/settings`);

    const off = await p.api
      .as(t.admin)
      .post(`/v2/calling/numbers/${number.uuid}/toggle`)
      .send({ enable: false });
    expect(off.body).toEqual({ callingEnabled: false, callingEnabledAt: null });
  });

  it("serves the operator's ICE servers to people who may call, and an empty list when none is set", async () => {
    const { t } = await setup('callice');
    delete process.env.CALLING_ICE_SERVERS;
    const none = await p.api.as(t.admin).get('/v2/calling/ice-servers');
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ servers: [] });
    process.env.CALLING_ICE_SERVERS = JSON.stringify([
      { urls: 'turn:turn.example.org:3478', username: 'u', credential: 'p' },
    ]);
    try {
      const some = await p.api.as(t.admin).get('/v2/calling/ice-servers');
      expect(some.body.servers).toEqual([
        { urls: 'turn:turn.example.org:3478', username: 'u', credential: 'p' },
      ]);
      const outsider = await p.api.member(t, 'noice', []);
      expect((await p.api.as(outsider.token).get('/v2/calling/ice-servers')).status).toBe(403);
    } finally {
      delete process.env.CALLING_ICE_SERVERS;
    }
  });

  it("refuses a coexistence number without asking Meta, and puts Meta's refusals in words", async () => {
    const { t, number } = await setup('callco', { calling: false, meta: { coexistence: true } });
    const r = await p.api
      .as(t.admin)
      .post(`/v2/calling/numbers/${number.uuid}/toggle`)
      .send({ enable: true });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('CALL_COEXISTENCE_UNSUPPORTED');
    expect(p.meta.settings()).toHaveLength(0);

    const b = await setup('callpre', { calling: false });
    p.meta.answer((req) =>
      req.path.endsWith('/settings') ? metaError(100, 'Calling pre-requisite not met') : undefined,
    );
    const pre = await p.api
      .as(b.t.admin)
      .post(`/v2/calling/numbers/${b.number.uuid}/toggle`)
      .send({ enable: true });
    expect(pre.status).toBe(422);
    expect(pre.body.code).toBe('CALL_META_REFUSED');
    expect(JSON.stringify(pre.body)).toContain('2,000');
    const still = await p.h.owner.query(
      `SELECT calling_enabled FROM wa_provider_configs WHERE id = $1`,
      [b.number.configId],
    );
    expect(still.rows[0].calling_enabled).toBe(false);
  });

  it('only people with the key can switch it, and a number of another workspace is not there', async () => {
    const { t, number } = await setup('callkey');
    const user = await p.api.member(t, 'caller', [['call.calls.use']]);
    expect(
      (
        await p.api
          .as(user.token)
          .post(`/v2/calling/numbers/${number.uuid}/toggle`)
          .send({ enable: true })
      ).status,
    ).toBe(403);
    expect((await p.api.as(user.token).get('/v2/calling/numbers')).status).toBe(200);
    const other = await p.api.signup('callother');
    const r = await p.api
      .as(other.admin)
      .post(`/v2/calling/numbers/${number.uuid}/toggle`)
      .send({ enable: true });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('CALL_NUMBER_NOT_FOUND');
  });
});

describe('call permission', () => {
  it("sends the request, resets the ledger, and keeps the customer's answer (one row, replaced)", async () => {
    const { t, number } = await setup('callperm');
    const res = await p.api
      .as(t.admin)
      .post('/v2/calling/permission-request')
      .send({ numberId: number.uuid, to: `+${CUSTOMER}`, body: 'Can we call about your order?' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ alreadyPermitted: false });
    const sent = p.meta.messages()[0]!.body as {
      to: string;
      interactive: { type: string; action: { name: string }; body: { text: string } };
    };
    expect(sent.to).toBe(CUSTOMER);
    expect(sent.interactive).toEqual({
      type: 'call_permission_request',
      action: { name: 'call_permission_request' },
      body: { text: 'Can we call about your order?' },
    });
    const ledger = () =>
      p.h.owner.query(
        `SELECT status, expires_at FROM wa_call_permissions WHERE wa_provider_config_id = $1`,
        [number.configId],
      );
    expect((await ledger()).rows).toEqual([expect.objectContaining({ status: 'expired' })]);

    const exp = Math.floor(Date.now() / 1000) + 3 * 86400;
    await grant(number, CUSTOMER, exp);
    let rows = (await ledger()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('granted');
    expect(new Date(rows[0].expires_at).getTime()).toBe(exp * 1000);

    await deliver(p, number, { event: 'permission_update', from: CUSTOMER, response: 'reject' });
    rows = (await ledger()).rows;
    expect(rows).toEqual([expect.objectContaining({ status: 'declined', expires_at: null })]);
  });

  it('Meta saying the business may already call is not a failure', async () => {
    const { t, number } = await setup('callalready');
    p.meta.answer((req) =>
      req.path.endsWith('/messages')
        ? metaError(138017, 'Business can already call this consumer')
        : undefined,
    );
    const res = await p.api
      .as(t.admin)
      .post('/v2/calling/permission-request')
      .send({ numberId: number.uuid, to: CUSTOMER });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ alreadyPermitted: true });
    const row = await p.h.owner.query(
      `SELECT status, expires_at FROM wa_call_permissions WHERE wa_provider_config_id = $1`,
      [number.configId],
    );
    expect(row.rows).toEqual([{ status: 'granted', expires_at: null }]);
  });

  it('refuses a question over 160 characters', async () => {
    const { t, number } = await setup('calllong');
    const r = await p.api
      .as(t.admin)
      .post('/v2/calling/permission-request')
      .send({ numberId: number.uuid, to: CUSTOMER, body: 'x'.repeat(161) });
    expect(r.status).toBe(422);
  });
});

describe('placing a call', () => {
  it('with no permission sends a request instead and places no call', async () => {
    const { t, number } = await setup('calldial0');
    const r = await p.api
      .as(t.admin)
      .post('/v2/calling/calls/dial')
      .send({ numberId: number.uuid, to: CUSTOMER, sdpOffer: SDP_OFFER });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('CALL_PERMISSION_REQUESTED');
    expect(p.meta.messages()).toHaveLength(1);
    expect(p.meta.action('connect')).toHaveLength(0);
    expect(
      (
        await p.h.owner.query(`SELECT count(*)::int AS n FROM wa_calls WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('with permission connects through Meta, then follows the customer picking up and hanging up', async () => {
    const { t, number } = await setup('calldial1');
    await grant(number);
    const mid = metaId();
    p.meta.answer((req) =>
      req.path.endsWith('/calls') && req.body.action === 'connect'
        ? { json: { calls: [{ id: mid }] } }
        : undefined,
    );

    const res = await p.api
      .as(t.admin)
      .post('/v2/calling/calls/dial')
      .send({ numberId: number.uuid, to: `+${CUSTOMER}`, sdpOffer: SDP_OFFER });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.metaCallId).toBe(mid);
    const connect = p.meta.action('connect')[0]!;
    expect(connect.body).toMatchObject({
      to: CUSTOMER,
      session: { sdp_type: 'offer', sdp: SDP_OFFER },
      biz_opaque_callback_data: res.body.correlation,
    });
    const row = await callRow(p, res.body.callId);
    expect(row).toMatchObject({
      status: 'ringing',
      direction: 'BUSINESS_INITIATED',
      provider: 'waba',
      to_phone: CUSTOMER,
    });

    const ringing = await p.api.as(t.admin).get(`/v2/calling/calls/${res.body.callId}/progress`);
    expect(ringing.body).toEqual({
      status: 'ringing',
      sdpAnswer: null,
      ended: false,
      endReason: null,
    });

    // The customer picks up: Meta's connect event carries the answer and echoes our correlation id.
    await deliver(p, number, {
      id: mid,
      event: 'connect',
      direction: 'BUSINESS_INITIATED',
      from: number.phone,
      to: CUSTOMER,
      biz_opaque_callback_data: res.body.correlation,
      session: { sdp_type: 'answer', sdp: SDP_ANSWER },
    });
    const active = await p.api.as(t.admin).get(`/v2/calling/calls/${res.body.callId}/progress`);
    expect(active.body).toEqual({
      status: 'active',
      sdpAnswer: SDP_ANSWER,
      ended: false,
      endReason: null,
    });
    expect(
      (
        await p.h.owner.query(`SELECT count(*)::int AS n FROM wa_calls WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(1);

    expect(
      (await p.api.as(t.admin).post(`/v2/calling/calls/${res.body.callId}/terminate`)).status,
    ).toBe(204);
    expect(p.meta.action('terminate')[0]!.body.call_id).toBe(mid);
    // Hanging up does not close the row: Meta's terminate event does, with the official duration.
    expect((await callRow(p, res.body.callId))!.status).toBe('active');
    await deliver(p, number, {
      id: mid,
      event: 'terminate',
      status: 'COMPLETED',
      duration: 130,
      start_time: String(Math.floor(Date.now() / 1000) - 130),
      end_time: String(Math.floor(Date.now() / 1000)),
    });
    const ended = await callRow(p, res.body.callId);
    expect(ended).toMatchObject({ status: 'ended', end_reason: 'COMPLETED', duration_sec: 130 });
    expect(await events(p, Number(ended!.id))).toEqual([
      'dial_sent',
      'connect',
      'terminate_sent',
      'terminate',
    ]);
    expect(
      (await p.api.as(t.admin).get(`/v2/calling/calls/${res.body.callId}/progress`)).body.ended,
    ).toBe(true);
  });

  it('a Meta refusal leaves a failed call, not a ringing one; a permission refusal asks for permission', async () => {
    const { t, number } = await setup('calldial2');
    await grant(number);
    p.meta.answer((req) =>
      req.body.action === 'connect' ? metaError(100, 'SDP Validation error') : undefined,
    );
    const r = await p.api
      .as(t.admin)
      .post('/v2/calling/calls/dial')
      .send({ numberId: number.uuid, to: CUSTOMER, sdpOffer: SDP_OFFER });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('CALL_META_REFUSED');
    expect(
      (
        await p.h.owner.query(`SELECT status, end_reason FROM wa_calls WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows,
    ).toEqual([{ status: 'failed', end_reason: 'META_REFUSED' }]);

    p.meta.reset();
    p.meta.answer((req) =>
      req.body.action === 'connect'
        ? metaError(131009, 'No approved call permission from the recipient', 401)
        : undefined,
    );
    const r2 = await p.api
      .as(t.admin)
      .post('/v2/calling/calls/dial')
      .send({ numberId: number.uuid, to: CUSTOMER, sdpOffer: SDP_OFFER });
    expect(r2.body.code).toBe('CALL_PERMISSION_REQUESTED');
    expect(p.meta.messages()).toHaveLength(1);
  });

  it('refuses a number with calling off and a short offer', async () => {
    const { t, number } = await setup('calldial3', { calling: false });
    const off = await p.api
      .as(t.admin)
      .post('/v2/calling/calls/dial')
      .send({ numberId: number.uuid, to: CUSTOMER, sdpOffer: SDP_OFFER });
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('CALL_NOT_ENABLED');
    const short = await p.api
      .as(t.admin)
      .post('/v2/calling/calls/dial')
      .send({ numberId: number.uuid, to: CUSTOMER, sdpOffer: 'v=0' });
    expect(short.status).toBe(422);
  });
});

describe('a customer calls', () => {
  it("rings the operators, who see it with the caller's name; the first to accept wins", async () => {
    const { t, number } = await setup('callin');
    await p.api.seedContacts(t, [{ name: 'Asha Rao', phone: `+${CUSTOMER}` }]);
    const mid = metaId();
    await deliver(p, number, {
      id: mid,
      event: 'connect',
      direction: 'USER_INITIATED',
      from: CUSTOMER,
      to: number.phone.replace(/\D/g, ''),
      timestamp: String(Math.floor(Date.now() / 1000)),
      session: { sdp_type: 'offer', sdp: SDP_OFFER },
    });
    await deliver(p, number, {
      id: mid,
      event: 'connect',
      direction: 'USER_INITIATED',
      from: CUSTOMER,
      to: number.phone.replace(/\D/g, ''),
      session: { sdp_type: 'offer', sdp: SDP_OFFER },
    });

    const pending = await p.api.as(t.admin).get('/v2/calling/calls/pending');
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    expect(pending.body.calls).toHaveLength(1);
    expect(pending.body.calls[0]).toMatchObject({
      contactName: 'Asha Rao',
      fromPhone: CUSTOMER,
      sdpOffer: SDP_OFFER,
      aiHandled: false,
      metaCallId: mid,
    });
    const id = pending.body.calls[0].id as string;

    const op2 = await p.api.member(t, 'second', [['call.calls.use']]);
    const [a, b] = await Promise.all([
      p.api.as(t.admin).post(`/v2/calling/calls/${id}/accept`).send({ sdpAnswer: SDP_ANSWER }),
      p.api.as(op2.token).post(`/v2/calling/calls/${id}/accept`).send({ sdpAnswer: SDP_ANSWER }),
    ]);
    expect([a.status, b.status].sort()).toEqual([204, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe('CALL_STATE_CONFLICT');
    // Meta saw one pre_accept, then one accept, with the same answer.
    expect(p.meta.action('pre_accept')).toHaveLength(1);
    expect(p.meta.action('accept')).toHaveLength(1);
    expect(p.meta.action('accept')[0]!.body.session).toEqual(
      p.meta.action('pre_accept')[0]!.body.session,
    );
    const row = await callRow(p, id);
    expect(row).toMatchObject({ status: 'active', handler_type: 'operator' });
    expect((await p.api.as(t.admin).get('/v2/calling/calls/pending')).body.calls).toHaveLength(0);
  });

  it('writes a call.changed event when a call rings and when it is answered, and the consumer pushes it to the workspace', async () => {
    const { RealtimeEmitter } = await import('../../../src/realtime');
    const { CallRealtimeConsumer } =
      await import('../../../src/modules/calling-voice/call-realtime.consumer');
    const emit = vi.spyOn(p.h.app.get(RealtimeEmitter), 'emit');
    const { t, number } = await setup('callpush');
    const mid = metaId();
    await deliver(p, number, {
      id: mid,
      event: 'connect',
      direction: 'USER_INITIATED',
      from: CUSTOMER,
      to: number.phone.replace(/\D/g, ''),
      timestamp: String(Math.floor(Date.now() / 1000)),
      session: { sdp_type: 'offer', sdp: SDP_OFFER },
    });
    const id = (await p.api.as(t.admin).get('/v2/calling/calls/pending')).body.calls[0]
      .id as string;
    const outbox = async () =>
      (
        await p.h.owner.query(
          `SELECT id, org_id, aggregate_id, payload FROM event_outbox
            WHERE org_id = $1 AND event_type = 'call.changed' ORDER BY id`,
          [t.orgId],
        )
      ).rows;
    expect(await outbox()).toHaveLength(1);

    expect(
      (
        await p.api
          .as(t.admin)
          .post(`/v2/calling/calls/${id}/accept`)
          .send({ sdpAnswer: SDP_ANSWER })
      ).status,
    ).toBe(204);
    const rows = await outbox();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((r) => r.payload.step)).toEqual(
      expect.arrayContaining(['connect', 'accept_sent']),
    );

    // The worker hands each to the consumer, which tells the workspace room the call's uuid and nothing else.
    const consumer = p.h.app.get(CallRealtimeConsumer);
    await consumer.handle({
      id: String(rows[0].id),
      orgId: t.orgId,
      aggregateModule: 'wa_calls',
      aggregateId: String(rows[0].aggregate_id),
      eventType: 'call.changed',
      payload: rows[0].payload,
    });
    expect(emit).toHaveBeenCalledWith(t.orgId, [{ kind: 'org' }], 'call.changed', { callId: id });
    emit.mockRestore();
  });

  it('puts the call back in line when Meta refuses the accept', async () => {
    const { t, number } = await setup('callinfail');
    const mid = metaId();
    await deliver(p, number, {
      id: mid,
      event: 'connect',
      direction: 'USER_INITIATED',
      from: CUSTOMER,
      to: '1',
      session: { sdp_type: 'offer', sdp: SDP_OFFER },
    });
    const id = (await p.api.as(t.admin).get('/v2/calling/calls/pending')).body.calls[0]
      .id as string;
    p.meta.answer((req) =>
      req.body.action === 'pre_accept' ? metaError(100, 'bad sdp') : undefined,
    );
    const r = await p.api
      .as(t.admin)
      .post(`/v2/calling/calls/${id}/accept`)
      .send({ sdpAnswer: SDP_ANSWER });
    expect(r.status).toBe(422);
    expect(await callRow(p, id)).toMatchObject({
      status: 'ringing',
      handler_type: null,
      handler_user_id: null,
    });
    p.meta.reset();
    expect(
      (
        await p.api
          .as(t.admin)
          .post(`/v2/calling/calls/${id}/accept`)
          .send({ sdpAnswer: SDP_ANSWER })
      ).status,
    ).toBe(204);
  });

  it('declines only a ringing call', async () => {
    const { t, number } = await setup('callrej');
    const mid = metaId();
    await deliver(p, number, {
      id: mid,
      event: 'connect',
      direction: 'USER_INITIATED',
      from: CUSTOMER,
      to: '1',
      session: { sdp_type: 'offer', sdp: SDP_OFFER },
    });
    const id = (await p.api.as(t.admin).get('/v2/calling/calls/pending')).body.calls[0]
      .id as string;
    expect(
      (await p.api.as(t.admin).post(`/v2/calling/calls/${id}/reject`).send({ reason: 'REJECTED' }))
        .status,
    ).toBe(204);
    expect(p.meta.action('reject')[0]!.body).toMatchObject({ call_id: mid, reason: 'REJECTED' });
    expect(await callRow(p, id)).toMatchObject({ status: 'ended', end_reason: 'REJECTED' });
    const again = await p.api.as(t.admin).post(`/v2/calling/calls/${id}/reject`).send({});
    expect(again.status).toBe(409);
  });

  it("a call that ends leaves one bubble in the customer's thread, however often Meta says so", async () => {
    const { t, number } = await setup('callbubble');
    const { linkChannel } = await import('../chat-conversations/whatsapp-support');
    const channel = await linkChannel(p.h, t.orgId, {
      configId: number.configId,
      phoneNumberId: number.phoneNumberId,
      wabaId: number.wabaId,
    });
    // The customer has a thread already (they wrote before they called).
    const { InboundIngestService } =
      await import('../../../src/modules/chat-conversations/inbound-ingest.service');
    const { RequestContextStore } = await import('../../../src/common/context/request-context');
    await RequestContextStore.run(
      { requestId: 'spec', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
      () =>
        p.h.app.get(InboundIngestService, { strict: false }).ingest({
          orgId: t.orgId,
          channelUuid: channel.uuid,
          message: {
            providerMessageId: `wamid.${Date.now()}`,
            peerKey: CUSTOMER,
            kind: 'text',
            body: 'hi',
            providerTimestamp: new Date().toISOString(),
          } as never,
        }),
    );
    const mid = metaId();
    await deliver(p, number, {
      id: mid,
      event: 'connect',
      direction: 'USER_INITIATED',
      from: CUSTOMER,
      to: '1',
      session: { sdp_type: 'offer', sdp: SDP_OFFER },
    });
    const terminate = { id: mid, event: 'terminate', status: 'COMPLETED', duration: 130 };
    await deliver(p, number, terminate);
    await deliver(p, number, terminate);
    const bubbles = await p.h.owner.query(
      `SELECT m.body, m.kind, m.direction, m.meta FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
       WHERE c.org_id = $1 AND m.kind = 'system'`,
      [t.orgId],
    );
    expect(bubbles.rows).toHaveLength(1);
    expect(bubbles.rows[0]).toMatchObject({
      body: 'Voice call - 2 min 10 s',
      kind: 'system',
      direction: 'in',
    });
    expect(bubbles.rows[0].meta).toMatchObject({
      event: 'call',
      callStatus: 'answered',
      durationSec: 130,
    });

    // A missed call (no duration) reads as missed.
    const m2 = metaId();
    await deliver(p, number, {
      id: m2,
      event: 'connect',
      direction: 'USER_INITIATED',
      from: CUSTOMER,
      to: '1',
      session: { sdp_type: 'offer', sdp: SDP_OFFER },
    });
    await deliver(p, number, { id: m2, event: 'terminate', status: 'FAILED', duration: 0 });
    const all = await p.h.owner.query(
      `SELECT body FROM messages WHERE org_id = $1 AND kind = 'system' ORDER BY seq`,
      [t.orgId],
    );
    expect(all.rows.map((r) => r.body)).toEqual(['Voice call - 2 min 10 s', 'Missed voice call']);
  });
});

describe('what the inbox needs to show the Call button', () => {
  it("reports the number's own permission, and a lapsed grant as expired", async () => {
    const { t, number } = await setup('calleli');
    const { linkChannel } = await import('../chat-conversations/whatsapp-support');
    const channel = await linkChannel(p.h, t.orgId, {
      configId: number.configId,
      phoneNumberId: number.phoneNumberId,
      wabaId: number.wabaId,
    });
    const { InboundIngestService } =
      await import('../../../src/modules/chat-conversations/inbound-ingest.service');
    const { RequestContextStore } = await import('../../../src/common/context/request-context');
    await RequestContextStore.run(
      { requestId: 'spec', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
      () =>
        p.h.app.get(InboundIngestService, { strict: false }).ingest({
          orgId: t.orgId,
          channelUuid: channel.uuid,
          message: {
            providerMessageId: `wamid.${Date.now()}`,
            peerKey: CUSTOMER,
            kind: 'text',
            body: 'hi',
            providerTimestamp: new Date().toISOString(),
          } as never,
        }),
    );
    const conv = (
      await p.h.owner.query(`SELECT uuid FROM conversations WHERE org_id = $1`, [t.orgId])
    ).rows[0].uuid as string;
    const ask = () => p.api.as(t.admin).get(`/v2/calling/eligibility?conversationId=${conv}`);

    expect((await ask()).body).toEqual({
      enabled: true,
      numberId: number.uuid,
      contactPhone: CUSTOMER,
      permission: null,
      usable: false,
    });
    await grant(number);
    expect((await ask()).body).toMatchObject({ permission: 'granted', usable: true });
    await p.h.owner.query(
      `UPDATE wa_call_permissions SET expires_at = now() - interval '1 hour' WHERE wa_provider_config_id = $1`,
      [number.configId],
    );
    expect((await ask()).body).toMatchObject({ permission: 'expired', usable: false });

    await p.h.owner.query(`UPDATE wa_provider_configs SET calling_enabled = false WHERE id = $1`, [
      number.configId,
    ]);
    expect((await ask()).body).toMatchObject({ enabled: false, numberId: null });
  });
});

describe('recordings', () => {
  // The first bytes of a WebM file: an EBML header declaring the document type "webm", padded.
  const WEBM = Buffer.concat([
    Buffer.from(
      '1a45dfa39f4286810142f7810142f2810442f3810842820477656 26d'.replace(/ /g, '') +
        '4287810442858102',
      'hex',
    ),
    Buffer.alloc(400, 0x7f),
  ]);

  it("stores the operator's file privately and plays it back to the workspace only", async () => {
    const { t, number } = await setup('callrec');
    await grant(number);
    const mid = metaId();
    p.meta.answer((req) =>
      req.body.action === 'connect' ? { json: { calls: [{ id: mid }] } } : undefined,
    );
    const call = await p.api
      .as(t.admin)
      .post('/v2/calling/calls/dial')
      .send({ numberId: number.uuid, to: CUSTOMER, sdpOffer: SDP_OFFER });
    const id = call.body.callId as string;
    await enableRecording(p, t);
    await grantConsentRow(p, t, id);

    const empty = await p.api
      .as(t.admin)
      .post(`/v2/calling/calls/${id}/recording`)
      .attach('recording', Buffer.alloc(10), 'x.webm');
    expect(empty.status).toBe(422);
    expect(empty.body.code).toBe('CALL_RECORDING_FAILED');

    const up = await p.api
      .as(t.admin)
      .post(`/v2/calling/calls/${id}/recording`)
      .attach('recording', WEBM, 'call.webm');
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.url).toBe(`/v2/calling/calls/${id}/recording`);
    const stored = (await callRow(p, id))!.recording_path as string;
    expect(stored.startsWith(`chat/${t.orgId}/`)).toBe(true);

    const got = await p.api
      .as(t.admin)
      .get(up.body.url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(got.status).toBe(200);
    expect((got.body as Buffer).length).toBe(WEBM.length);

    const other = await p.api.signup('callrecother');
    expect((await p.api.as(other.admin).get(up.body.url)).status).toBe(404);

    // A second upload replaces the first: one file, not two.
    const again = await p.api
      .as(t.admin)
      .post(`/v2/calling/calls/${id}/recording`)
      .attach('recording', WEBM, 'call.webm');
    expect(again.status).toBe(200);
    const second = (await callRow(p, id))!.recording_path as string;
    expect(second).not.toBe(stored);
  });

  it('a call with no recording has none to play', async () => {
    const { t, number } = await setup('callrec2');
    const mid = metaId();
    await deliver(p, number, {
      id: mid,
      event: 'connect',
      direction: 'USER_INITIATED',
      from: CUSTOMER,
      to: '1',
      session: { sdp_type: 'offer', sdp: SDP_OFFER },
    });
    const id = (await p.api.as(t.admin).get('/v2/calling/calls/pending')).body.calls[0]
      .id as string;
    expect((await p.api.as(t.admin).get(`/v2/calling/calls/${id}/recording`)).status).toBe(404);
  });
});

describe("Meta's handshake on the calling address", () => {
  it('echoes the challenge for the right token and refuses anything else', async () => {
    const { WabaWebhookService } = await import('../../../src/modules/whatsapp-cloud-api-waba');
    const { verifyTokenFor } =
      await import('../../../src/modules/whatsapp-cloud-api-waba/waba-rules');
    const key = process.env.CREDENTIALS_ENCRYPTION_KEY!;
    const token = verifyTokenFor(
      process.env.WABA_VERIFY_TOKEN ?? process.env.WHATSAPP_VERIFY_TOKEN,
      key,
    );
    void WabaWebhookService;
    const ok = await p.api
      .http()
      .get('/v2/public/webhooks/wa-calling')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': 'abc123' });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.text).toBe('abc123');
    const bad = await p.api
      .http()
      .get('/v2/public/webhooks/wa-calling')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'abc123' });
    expect(bad.status).toBe(403);
  });
});
