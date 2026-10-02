import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { BroadcastDispatchService } from '../../../src/modules/broadcasts/broadcast-dispatch.service';
import { BroadcastProgressService } from '../../../src/modules/broadcasts/broadcast-progress.service';
import { BroadcastResumeService } from '../../../src/modules/broadcasts/broadcast-resume.service';
import {
  EngineSenderRegistry,
  type OutgoingMessage,
} from '../../../src/modules/broadcasts/engine-senders';
import { DEFAULT_PACING, type PacingSettings } from '../../../src/modules/broadcasts/pacing';
import {
  CapTally,
  PACING_SETTINGS,
  PacingRuntime,
  SenderLease,
  type PacingSettingsSource,
} from '../../../src/modules/broadcasts/send-safety';
import { WARMER_GATE, type WarmerGate } from '../../../src/modules/broadcasts/_shims/tokens';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { AppError } from '../../../src/common/errors/app-error';
import { ERROR_CODES } from '@crm/contracts';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Pacing, batches, the daily cap, pausing and resuming, and one run at a time per sender (TW-BCAST-022): the real app and
 * Postgres and Redis, with a recorded clock and a fixed roll of the dice.
 */
let h: Harness;
let api: Api;
let runtime: PacingRuntime;
let dispatch: BroadcastDispatchService;
let settings: PacingSettingsSource & { get: PacingSettingsSource['get'] };
let warmer: WarmerGate;
let sent: OutgoingMessage[] = [];
let sleeps: number[] = [];
let behaviour: (n: number) => string | Error = (n) => `wamid.${n}`;

const setPacing = (p: Partial<PacingSettings>) => {
  settings.get = () => Promise.resolve({ ...DEFAULT_PACING, ...p });
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  runtime = h.app.get(PacingRuntime);
  dispatch = h.app.get(BroadcastDispatchService);
  settings = h.app.get(PACING_SETTINGS);
  warmer = h.app.get(WARMER_GATE);
  h.app.get(EngineSenderRegistry).register('baileys', {
    open: () =>
      Promise.resolve({
        send: (m: OutgoingMessage) => {
          sent.push(m);
          const out = behaviour(sent.length);
          return out instanceof Error
            ? Promise.reject(out)
            : Promise.resolve({ providerMessageId: out });
        },
      }),
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  sent = [];
  sleeps = [];
  behaviour = (n) => `wamid.${n}`;
  runtime.sleep = (ms) => {
    sleeps.push(ms);
    return Promise.resolve();
  };
  runtime.random = () => 0.5;
  runtime.now = () => new Date();
  setPacing({});
  warmer.gap = () => Promise.resolve(null);
});

let counter = 0;
async function arrange(label: string, n: number) {
  const t = await api.signup(label);
  const tpl = (
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, status) VALUES ($1,'p','x','approved') RETURNING uuid`,
      [t.orgId],
    )
  ).rows[0].uuid as string;
  const dev = (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active) VALUES ($1,'D','+91','9811100005','connected',true) RETURNING id, uuid`,
      [t.orgId],
    )
  ).rows[0];
  const contacts = await api.seedContacts(
    t,
    Array.from({ length: n }, (_, i) => ({
      name: `P${i}`,
      phone: `+91987${String(counter++).padStart(7, '0')}`,
    })),
  );
  return { t, tpl, device: { id: Number(dev.id), key: `baileys:${dev.uuid}` }, contacts };
}

async function create(a: { t: Tenant; tpl: string; device: { key: string }; contacts: string[] }) {
  const res = await api
    .http()
    .post('/v2/broadcasts')
    .set(bearer(a.t.admin))
    .set('idempotency-key', randomUUID())
    .send({
      name: 'Paced',
      templateId: a.tpl,
      contactIds: a.contacts,
      senderKeys: [a.device.key],
      scheduleType: 'now',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const uuid = res.body.broadcasts[0].id as string;
  return {
    uuid,
    id: Number(
      (await h.owner.query(`SELECT id FROM broadcasts WHERE uuid = $1`, [uuid])).rows[0].id,
    ),
  };
}

const run = (t: Tenant, id: number) =>
  RequestContextStore.run(
    { requestId: `p-${id}`, orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
    () => dispatch.run(t.orgId, id),
  );

const row = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, success_count, messages_log, node_schedule_id FROM broadcasts WHERE id = $1`,
      [id],
    )
  ).rows[0];
const statuses = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status FROM broadcast_contacts WHERE broadcast_id = $1 ORDER BY id`,
      [id],
    )
  ).rows.map((r) => r.status);

describe('TW-BCAST-022: the gap between messages', () => {
  it('3 recipients and a 3 s gap: a pause between each, none after the last', async () => {
    const a = await arrange('g1', 3);
    const b = await create(a);
    await run(a.t, b.id);
    expect(sent).toHaveLength(3);
    expect(sleeps).toEqual([3000, 3000]);
  });

  it('the pause is the setting plus or minus 20%: 2.4 to 3.6 s', async () => {
    for (const [dice, expected] of [
      [0, 2400],
      [1, 3600],
    ] as const) {
      sleeps = [];
      runtime.random = () => dice;
      const a = await arrange(`g2${dice}`, 2);
      await run(a.t, (await create(a)).id);
      expect(sleeps).toEqual([expected]);
    }
  });

  it('a warming number uses its own range instead', async () => {
    warmer.gap = () => Promise.resolve({ min: 10, max: 10 });
    const a = await arrange('g3', 3);
    await run(a.t, (await create(a)).id);
    expect(sleeps).toEqual([10_000, 10_000]);
  });

  it('a recipient without a number is not a send, so it costs no pause', async () => {
    const a = await arrange('g4', 1);
    const extra = await api.seedContacts(a.t, [{ name: 'None', email: 'n@x.test' }]);
    const b = await create({ ...a, contacts: [...extra, ...a.contacts] });
    await run(a.t, b.id);
    expect(sent).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe('TW-BCAST-022: batches', () => {
  it('5 recipients in batches of 2 with a 5 minute cooldown: a rest after each full batch, kept alive in short beats', async () => {
    setPacing({ enableBatches: true, batchSize: 2, batchGapMinutes: 5 });
    const a = await arrange('b1', 5);
    await run(a.t, (await create(a)).id);
    expect(sent).toHaveLength(5);
    // after #1 a gap, #2 a cooldown, #3 a gap, #4 a cooldown, none after #5
    expect(sleeps.reduce((x, y) => x + y, 0)).toBe(3000 + 300_000 + 3000 + 300_000);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(20_000);
  });

  it('a small audience is not batched', async () => {
    setPacing({ enableBatches: true, batchSize: 50, batchGapMinutes: 5 });
    const a = await arrange('b2', 3);
    await run(a.t, (await create(a)).id);
    expect(sleeps).toEqual([3000, 3000]);
  });
});

describe('TW-BCAST-022: the daily cap', () => {
  it('stops at the cap with nobody lost, saying why and when it can resume', async () => {
    setPacing({ baileysDailyCap: 2 });
    const a = await arrange('c1', 5);
    const b = await create(a);
    expect(await run(a.t, b.id)).toBe('paused');
    expect(sent).toHaveLength(2);
    expect(await statuses(b.id)).toEqual(['sent', 'sent', 'pending', 'pending', 'pending']);
    const r = await row(b.id);
    expect(r.status).toBe('paused');
    expect(r.messages_log.pause.reason).toBe('daily_cap');
    expect(new Date(r.messages_log.pause.resumeAfter).getTime()).toBeGreaterThan(Date.now());

    const detail = (await api.http().get(`/v2/broadcasts/${b.uuid}`).set(bearer(a.t.admin))).body;
    expect(detail.pause).toMatchObject({ reason: 'daily_cap' });
    expect(detail.events.status).toBe('paused');
  });

  it('a send is not started when the cap is already used up today', async () => {
    setPacing({ baileysDailyCap: 1 });
    const a = await arrange('c2', 2);
    const tally = h.app.get(CapTally);
    await tally.bump(a.t.orgId, 'baileys', a.device.id);
    expect(await run(a.t, (await create(a)).id)).toBe('paused');
    expect(sent).toHaveLength(0);
  });

  it('resumes by itself after midnight UTC and carries on where it stopped', async () => {
    setPacing({ baileysDailyCap: 2 });
    const a = await arrange('c3', 5);
    const b = await create(a);
    await run(a.t, b.id);
    const sweeper = new BroadcastResumeService(
      h.app.get(DatabaseService),
      h.app.get(BroadcastProgressService),
      h.app.get(OutboxService),
      { isHalted: () => Promise.resolve(false) } as never,
      runtime,
    );

    expect(await sweeper.sweep()).toBe(0); // before midnight: nothing to do
    expect((await row(b.id)).status).toBe('paused');

    const tomorrow = new Date(Date.now() + 36 * 3600_000);
    runtime.now = () => tomorrow;
    expect(await sweeper.sweep()).toBeGreaterThanOrEqual(1);
    expect(await row(b.id)).toMatchObject({ status: 'processing', node_schedule_id: null });
    expect((await row(b.id)).messages_log.pause).toBeUndefined();

    setPacing({ baileysDailyCap: 4000 });
    expect(await run(a.t, b.id)).toBe('finished');
    expect(sent).toHaveLength(5); // 2 before the pause, the other 3 after; nobody twice
    expect(await statuses(b.id)).toEqual(['sent', 'sent', 'sent', 'sent', 'sent']);
    expect((await row(b.id)).status).toBe('completed');
  });
});

describe('TW-BCAST-022: pause and resume by hand', () => {
  const pausedByHalt = async (label: string) => {
    const a = await arrange(label, 3);
    const b = await create(a);
    behaviour = (n) =>
      n === 2
        ? (new AppError(ERROR_CODES.AUTH_SEND_HALTED, 'halted', 503) as unknown as Error)
        : `wamid.${n}`;
    expect(await run(a.t, b.id)).toBe('paused');
    return { a, b };
  };

  it('an emergency halt pauses with the reason kept; resume sends only what is left', async () => {
    const { a, b } = await pausedByHalt('m1');
    expect((await row(b.id)).messages_log.pause.reason).toBe('halt');
    expect(await statuses(b.id)).toEqual(['sent', 'pending', 'pending']);

    behaviour = (n) => `wamid.${n}`;
    const res = await api
      .http()
      .post(`/v2/broadcasts/${b.uuid}/resume`)
      .set(bearer(a.t.admin))
      .set('idempotency-key', randomUUID());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ status: 'processing' });
    expect((await row(b.id)).messages_log.pause).toBeUndefined();
    const before = sent.length;
    expect(await run(a.t, b.id)).toBe('finished');
    expect(sent.length - before).toBe(2);
    expect(await statuses(b.id)).toEqual(['sent', 'sent', 'sent']);
  });

  it('only a paused broadcast can be resumed; a foreign one is a 404; a member without the key gets 403', async () => {
    const a = await arrange('m2', 1);
    const b = await create(a);
    const post = (token: string, uuid: string) =>
      api
        .http()
        .post(`/v2/broadcasts/${uuid}/resume`)
        .set(bearer(token))
        .set('idempotency-key', randomUUID());
    const notPaused = await post(a.t.admin, b.uuid);
    expect(notPaused.status).toBe(409);
    expect(notPaused.body.code).toBe('BCAST_NOT_RESUMABLE');

    const other = await arrange('m2b', 1);
    expect((await post(other.t.admin, b.uuid)).status).toBe(404);
    const viewer = await api.member(a.t, 'viewer', [['bcast.broadcasts.read']]);
    expect((await post(viewer.token, b.uuid)).status).toBe(403);
  });

  it('a halt pause resumes by itself once the halt is lifted, not before', async () => {
    const { b } = await pausedByHalt('m3');
    const db = h.app.get(DatabaseService);
    const make = (halted: boolean) =>
      new BroadcastResumeService(
        db,
        h.app.get(BroadcastProgressService),
        h.app.get(OutboxService),
        { isHalted: () => Promise.resolve(halted) } as never,
        runtime,
      );
    await make(true).sweep();
    expect((await row(b.id)).status).toBe('paused');
    await make(false).sweep();
    expect((await row(b.id)).status).toBe('processing');
  });
});

describe('TW-BCAST-022: one run at a time per sender', () => {
  it('a second run through the same number is told to wait and sends nothing; it can go once the first lets go', async () => {
    const a = await arrange('l1', 2);
    const b = await create(a);
    const lease = h.app.get(SenderLease);
    const key = SenderLease.key(a.t.orgId, 'baileys', a.device.id);
    const token = await lease.acquire(key);
    expect(token).not.toBeNull();

    expect(await run(a.t, b.id)).toBe('busy');
    expect(sent).toHaveLength(0);
    expect(await statuses(b.id)).toEqual(['pending', 'pending']);

    await lease.release(key, token!);
    expect(await run(a.t, b.id)).toBe('finished');
    expect(sent).toHaveLength(2);
  });

  it('the lease is given back when a run finishes, so the next broadcast on the number can start', async () => {
    const a = await arrange('l2', 1);
    const first = await create(a);
    const second = await create(a);
    expect(await run(a.t, first.id)).toBe('finished');
    expect(await run(a.t, second.id)).toBe('finished');
  });
});
