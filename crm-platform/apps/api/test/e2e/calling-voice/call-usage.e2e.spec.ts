import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TELEPHONY_SIGNATURE_HEADER,
  TELEPHONY_TIMESTAMP_HEADER,
  USAGE_REPORTED_EVENT,
} from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  FakeTelephonyProvider,
  signTelephonyCallback,
} from '../../../src/infra/providers/telephony';
import { CallEventsService } from '../../../src/modules/calling-voice/call-events.service';
import type { InboundContext } from '../../../src/modules/whatsapp-cloud-api-waba';
import {
  addNumber,
  callsValue,
  fundWallet,
  startCallPipeline,
  SDP_OFFER,
  type CallNumber,
  type CallPipeline,
  type Tenant,
} from './support';

/**
 * Calls are paid usage. What a call reports to the wallet, once, in the transaction that records it (`usage.reported` in the outbox; the
 * wallet's worker prices it and writes the expense, which the wallet suites cover), and which calls are refused before they are placed.
 * The rules: WhatsApp calls are reported when Meta ends them; a provider-reported COMPLETED call with talk time is reported when it is
 * logged; a call a person typed in is never reported; an empty wallet refuses a click-to-call.
 */
let p: CallPipeline;
beforeAll(async () => {
  p = await startCallPipeline();
}, 900_000);
afterAll(async () => {
  await p?.stop();
});

let seq = 0;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const rows = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) =>
  (await p.h.owner.query(sql, args)).rows as T[];
const post = (token: string, path: string, body: unknown) =>
  p.api
    .as(token)
    .post(path)
    .send(body as object);
const waitFor = async <T>(fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 150));
  }
};
const usageOf = (t: Tenant) => p.api.events(t.orgId, USAGE_REPORTED_EVENT);

describe('a WhatsApp call', () => {
  const ctxOf = (t: Tenant, n: CallNumber): InboundContext => ({
    orgId: t.orgId,
    configId: n.configId,
    configUuid: n.uuid,
    wabaId: n.wabaId,
    phoneNumberId: n.phoneNumberId,
    contactName: null,
  });

  /** Meta's `calls` webhook value, handed to the calling domain the way the WABA domain's sink hands it, inside a system context. */
  async function hear(t: Tenant, n: CallNumber, call: Record<string, unknown>) {
    const events = p.h.app.get(CallEventsService, { strict: false });
    await RequestContextStore.run(
      {
        requestId: `e2e-call-${seq++}`,
        orgId: t.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => events.handle(ctxOf(t, n), callsValue(n, call)),
    );
  }

  const now = () => Math.floor(Date.now() / 1000);
  const ours = (n: CallNumber) => n.phone.replace(/\D/g, '');

  async function ring(t: Tenant, n: CallNumber, o: { outbound?: boolean } = {}) {
    const id = `wacid.usage.${Date.now()}.${seq++}`;
    const customer = `91981150${String(1000 + seq++)}`;
    await hear(t, n, {
      event: 'connect',
      id,
      from: o.outbound ? ours(n) : customer,
      to: o.outbound ? customer : ours(n),
      direction: o.outbound ? 'BUSINESS_INITIATED' : 'USER_INITIATED',
      timestamp: now(),
      session: { sdp_type: 'offer', sdp: SDP_OFFER },
    });
    return { id, customer };
  }

  const end = (t: Tenant, n: CallNumber, id: string, over: Record<string, unknown> = {}) =>
    hear(t, n, { event: 'terminate', id, status: 'COMPLETED', end_time: now(), ...over });

  async function setup(label: string) {
    const t = await p.api.signup(label);
    return { t, number: await addNumber(p, t) };
  }

  it('is reported once Meta ends it: every started minute, under Meta’s call id, in the same transaction as the call row', async () => {
    const { t, number } = await setup('cu1');
    const { id, customer } = await ring(t, number);
    expect(await usageOf(t)).toHaveLength(0); // ringing is not usage
    await end(t, number, id, { duration: 125 });

    const reported = await usageOf(t);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      kind: 'whatsapp_call',
      usageId: id,
      status: 'used',
      units: 3,
      recipient: customer,
      source: 'inbox',
      provider: 'meta',
    });
    const call = await rows<{ id: string; duration_sec: number }>(
      `SELECT id, duration_sec FROM wa_calls WHERE org_id = $1 AND meta_call_id = $2`,
      [t.orgId, id],
    );
    expect(call[0]!.duration_sec).toBe(125);
    const outbox = await rows<{ aggregate_module: string; aggregate_id: string }>(
      `SELECT aggregate_module, aggregate_id FROM event_outbox WHERE org_id = $1 AND event_type = $2`,
      [t.orgId, USAGE_REPORTED_EVENT],
    );
    expect(outbox.map((r) => [r.aggregate_module, Number(r.aggregate_id)])).toEqual([
      ['calls', Number(call[0]!.id)],
    ]);
  });

  it('is reported under the same id whenever Meta repeats its terminate, so the wallet charges it once', async () => {
    const { t, number } = await setup('cu2');
    const { id } = await ring(t, number);
    await end(t, number, id, { duration: 61 });
    await end(t, number, id, { duration: 61 });
    const reported = await usageOf(t);
    expect(reported.length).toBeGreaterThanOrEqual(1);
    expect(new Set(reported.map((r) => r.usageId))).toEqual(new Set([id]));
    expect(new Set(reported.map((r) => r.units))).toEqual(new Set([2]));
  });

  it('is not reported when nobody answered, and a later terminate with the real duration is still billed', async () => {
    const { t, number } = await setup('cu3');
    const { id } = await ring(t, number);
    await end(t, number, id, { status: 'FAILED' });
    expect(await usageOf(t)).toHaveLength(0);
    // A zero-minute report must never claim the call's id: the duration that follows decides the bill.
    await end(t, number, id, { duration: 61 });
    expect(await usageOf(t)).toMatchObject([{ kind: 'whatsapp_call', usageId: id, units: 2 }]);
  });

  it('names the customer’s number on a call we placed, not our own', async () => {
    const { t, number } = await setup('cu4');
    const { id, customer } = await ring(t, number, { outbound: true });
    await end(t, number, id, { duration: 59 });
    const reported = await usageOf(t);
    expect(reported[0]).toMatchObject({ usageId: id, units: 1, recipient: customer });
  });

  it('reports nothing for a call we never saw ring', async () => {
    const { t, number } = await setup('cu5');
    await end(t, number, `wacid.unknown.${seq++}`, { duration: 300 });
    expect(await usageOf(t)).toHaveLength(0);
  });

  it('keeps one workspace’s calls out of another’s outbox', async () => {
    const a = await setup('cu6a');
    const b = await setup('cu6b');
    const { id } = await ring(a.t, a.number);
    await end(a.t, a.number, id, { duration: 30 });
    expect(await usageOf(a.t)).toHaveLength(1);
    expect(await usageOf(b.t)).toHaveLength(0);
  });
});

describe('a call through the workspace’s telephony provider', () => {
  async function setup(label: string) {
    const t = await p.api.signup(label);
    const phone = `+919811500${String(1000 + seq++)}`;
    const [contactId] = await p.api.seedContacts(t, [{ name: 'Asha Rao', phone }]);
    const res = await post(t.admin, '/v2/calls/telephony/connections', {
      provider: 'fake',
      label: 'Sales line',
      numbers: ['+918012345678'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return {
      t,
      phone,
      contactId: contactId!,
      conn: {
        id: res.body.connection.id as string,
        secret: res.body.secret as string,
        path: res.body.connection.webhookPath as string,
      },
    };
  }

  const callbackBody = (callId: string, over: Record<string, unknown> = {}, eventId?: string) =>
    JSON.stringify({
      id: eventId ?? `evt-${seq++}`,
      type: 'call.completed',
      call: {
        id: callId,
        direction: 'inbound',
        status: 'completed',
        from: '+919811400001',
        to: '+918012345678',
        startedAt: iso(10 * 60_000),
        durationSec: 125,
        ...over,
      },
    });

  const send = (path: string, raw: string, secret: string) => {
    const stamp = String(Math.floor(Date.now() / 1000));
    return p.api
      .http()
      .post(path)
      .set('content-type', 'application/json')
      .set(TELEPHONY_TIMESTAMP_HEADER, stamp)
      .set(TELEPHONY_SIGNATURE_HEADER, signTelephonyCallback(secret, stamp, Buffer.from(raw)))
      .send(raw);
  };

  const entryCount = async (t: Tenant) =>
    (await rows(`SELECT 1 FROM call_log_entries WHERE org_id = $1`, [t.orgId])).length;

  it('reports a completed call with talk time, once, under the entry’s own id', async () => {
    const { t, conn } = await setup('tu1');
    const callId = `CA-usage-${seq++}`;
    expect((await send(conn.path, callbackBody(callId), conn.secret)).status).toBe(204);
    const [reported] = await waitFor(async () => {
      const r = await usageOf(t);
      return r.length ? r : false;
    });
    expect(reported).toMatchObject({
      kind: 'voice_call',
      usageId: `${conn.id}:${callId}`,
      status: 'used',
      units: 3,
      source: 'telephony',
      provider: 'fake',
      recipient: '+919811400001',
    });
    const entry = await rows<{ id: string; external_id: string }>(
      `SELECT id, external_id FROM call_log_entries WHERE org_id = $1`,
      [t.orgId],
    );
    expect(entry[0]!.external_id).toBe(`${conn.id}:${callId}`);
    const outbox = await rows<{ aggregate_module: string; aggregate_id: string }>(
      `SELECT aggregate_module, aggregate_id FROM event_outbox WHERE org_id = $1 AND event_type = $2`,
      [t.orgId, USAGE_REPORTED_EVENT],
    );
    expect(outbox.map((r) => [r.aggregate_module, Number(r.aggregate_id)])).toEqual([
      ['call_log_entries', Number(entry[0]!.id)],
    ]);
  });

  it('reports a call delivered again (or under another event id) once', async () => {
    const { t, conn } = await setup('tu2');
    const callId = `CA-usage-${seq++}`;
    const raw = callbackBody(callId, {}, `evt-same-${seq++}`);
    await send(conn.path, raw, conn.secret);
    await send(conn.path, raw, conn.secret);
    await send(conn.path, callbackBody(callId, {}, `evt-other-${seq++}`), conn.secret);
    await waitFor(async () => ((await entryCount(t)) >= 1 ? true : false));
    await new Promise((r) => setTimeout(r, 1500));
    expect(await entryCount(t)).toBe(1);
    expect(await usageOf(t)).toHaveLength(1);
  });

  it('reports nothing for a call that was not completed or had no talk time', async () => {
    const { t, conn } = await setup('tu3');
    for (const [status, durationSec] of [
      ['no_answer', 0],
      ['busy', 0],
      ['declined', 0],
      ['failed', 0],
      ['voicemail', 20],
      ['completed', 0],
    ] as const) {
      expect(
        (
          await send(
            conn.path,
            callbackBody(`CA-free-${seq++}`, { status, durationSec }),
            conn.secret,
          )
        ).status,
      ).toBe(204);
    }
    await waitFor(async () => ((await entryCount(t)) === 6 ? true : false));
    expect(await usageOf(t)).toHaveLength(0);
  });

  it('never reports a call a person typed in', async () => {
    const { t, contactId } = await setup('tu4');
    const logged = await post(t.admin, '/v2/calls/log', {
      contactId,
      direction: 'outbound',
      outcome: 'connected',
      durationSec: 600,
    });
    expect(logged.status, JSON.stringify(logged.body)).toBe(201);
    expect(await usageOf(t)).toHaveLength(0);
  });

  it('refuses a click-to-call with an empty wallet before the provider is asked, and places it once funded', async () => {
    const { t, contactId, conn } = await setup('tu5');
    const fake = p.h.app.get(FakeTelephonyProvider, { strict: false });
    fake.placed.length = 0;
    const ask = () =>
      post(t.admin, '/v2/calls/click-to-call', {
        connectionId: conn.id,
        contactId,
        agentPhone: '+919000000001',
      });

    const refused = await ask();
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe('WALLET_EMPTY');
    expect(fake.placed).toHaveLength(0);
    expect(
      await rows(`SELECT 1 FROM telephony_click_calls WHERE org_id = $1`, [t.orgId]),
    ).toHaveLength(0);

    await fundWallet(p, t);
    const placed = await ask();
    expect(placed.status, JSON.stringify(placed.body)).toBe(200);
    expect(fake.placed).toHaveLength(1);
  });

  it('lets a platform-owned workspace place a call with an empty wallet', async () => {
    const { t, contactId, conn } = await setup('tu6');
    await p.h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides, platform_owned) VALUES ($1, '{}'::jsonb, true)
       ON CONFLICT (org_id) DO UPDATE SET platform_owned = true`,
      [t.orgId],
    );
    const res = await post(t.admin, '/v2/calls/click-to-call', {
      connectionId: conn.id,
      contactId,
      agentPhone: '+919000000001',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});
