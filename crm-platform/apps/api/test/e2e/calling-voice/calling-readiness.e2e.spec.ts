import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { SCHEDULE_TICK_MS } from '../../../src/modules/calling-voice/calling-readiness.jobs';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  addNumber,
  deliver,
  enableRecording,
  metaError,
  startCallPipeline,
  SDP_OFFER,
  type CallNumber,
  type CallPipeline,
  type MetaRequest,
  type Tenant,
} from './support';

// The platform's own Meta app, so a number whose token belongs to it can have its `calls` field read and added.
process.env.META_APP_ID = '1111';
process.env.META_APP_SECRET = 'app-secret';

let p: CallPipeline;
beforeAll(async () => {
  p = await startCallPipeline();
  setIce(TURN);
}, 300_000);
afterAll(async () => {
  if (p) setIce('');
  await p?.stop();
});

/** `CALLING_ICE_SERVERS` as the app reads it: its config service caches the first value it sees, so a spec sets it through that service. */
const setIce = (value: string) =>
  p.h.app.get(ConfigService, { strict: false }).set('CALLING_ICE_SERVERS', value);

const TURN = JSON.stringify([
  { urls: 'turn:turn.example.org:3478', username: 'u', credential: 'p' },
]);

interface World {
  tier?: string;
  status?: string;
  verification?: string;
  platform?: string;
  quality?: string;
  scopes?: readonly string[];
  appId?: string;
  wabaApps?: number;
  calling?: 'ENABLED' | 'DISABLED';
  icon?: string;
  /** Fields the platform app is subscribed to; `null` = the app has no WhatsApp subscription at all. */
  appFields?: string[] | null;
  /** Make a read fail: path suffix to a Meta answer. */
  fail?: Record<string, { status?: number; json?: unknown }>;
}

/** What Meta answers for one number, for the reads a readiness check makes. */
function arrange(n: CallNumber, w: World = {}) {
  const world: Required<Pick<World, 'calling'>> & World = { calling: 'ENABLED', ...w };
  p.meta.reset();
  p.meta.answer((req: MetaRequest) => {
    const failed = Object.entries(world.fail ?? {}).find(([suffix]) => req.path.endsWith(suffix));
    if (failed) return failed[1];
    if (req.method === 'GET' && req.path === `/${n.phoneNumberId}`) {
      return {
        json: {
          id: n.phoneNumberId,
          status: world.status ?? 'CONNECTED',
          code_verification_status: world.verification ?? 'VERIFIED',
          platform_type: world.platform ?? 'CLOUD_API',
          account_mode: 'LIVE',
          quality_rating: world.quality ?? 'GREEN',
          messaging_limit_tier: world.tier ?? 'TIER_10K',
        },
      };
    }
    if (req.path === '/debug_token') {
      return {
        json: {
          data: {
            is_valid: true,
            app_id: world.appId ?? '1111',
            scopes: world.scopes ?? ['whatsapp_business_management', 'whatsapp_business_messaging'],
          },
        },
      };
    }
    if (req.method === 'GET' && req.path === `/${n.wabaId}/subscribed_apps`) {
      return {
        json: {
          data: Array.from({ length: world.wabaApps ?? 1 }, (_, i) => ({
            whatsapp_business_api_data: { name: `app${i}` },
          })),
        },
      };
    }
    if (req.method === 'GET' && req.path === `/${n.phoneNumberId}/settings`) {
      return {
        json: { calling: { status: world.calling, call_icon_visibility: world.icon ?? 'DEFAULT' } },
      };
    }
    if (req.method === 'POST' && req.path === `/${n.phoneNumberId}/settings`) {
      world.calling = (req.body.calling as { status: 'ENABLED' | 'DISABLED' }).status;
      return { json: { success: true } };
    }
    if (req.method === 'GET' && req.path === '/1111/subscriptions') {
      const fields = world.appFields === undefined ? ['messages', 'calls'] : world.appFields;
      return {
        json: {
          data:
            fields === null
              ? []
              : [
                  {
                    object: 'whatsapp_business_account',
                    callback_url: 'https://platform.example.org/hook',
                    fields: fields.map((name) => ({ name })),
                  },
                ],
        },
      };
    }
    if (req.method === 'POST' && req.path === '/1111/subscriptions') {
      world.appFields = String(req.body.fields).split(',');
      return { json: { success: true } };
    }
    return undefined;
  });
  return world;
}

async function setup(label: string, o: { calling?: boolean; meta?: Record<string, unknown> } = {}) {
  const t = await p.api.signup(label);
  const number = await addNumber(p, t, { calling: false, ...o });
  return { t, number };
}

const check = (t: Tenant, n: CallNumber, source?: string) =>
  p.api
    .as(t.admin)
    .post(`/v2/calling/numbers/${n.uuid}/readiness/check`)
    .send(source ? { source } : {});

const codes = (body: { checks: Array<{ key: string; code: string }> }) =>
  Object.fromEntries(body.checks.map((c) => [c.key, c.code]));
const states = (body: { checks: Array<{ key: string; state: string }> }) =>
  Object.fromEntries(body.checks.map((c) => [c.key, c.state]));

const systemRun = <T>(orgId: number, fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: `test-${orgId}`, orgId, actorType: 'system', actorId: null, userId: null },
    fn,
  );

const readiness = async () => {
  const { CallingReadinessService } =
    await import('../../../src/modules/calling-voice/calling-readiness.service');
  return p.h.app.get(CallingReadinessService, { strict: false });
};

const localFlag = async (n: CallNumber) =>
  (
    await p.h.owner.query(`SELECT calling_enabled FROM wa_provider_configs WHERE id = $1`, [
      n.configId,
    ])
  ).rows[0].calling_enabled as boolean;

const setPlan = (t: Tenant, calling: boolean) =>
  p.h.owner.query(`UPDATE org_plan_state SET overrides = $2 WHERE org_id = $1`, [
    t.orgId,
    calling ? '{}' : '{"features":{"waba_calling":false}}',
  ]);

describe('a number that is ready', () => {
  it('shows every row ok once calling is on, and keeps the result for the list and the single read', async () => {
    setIce(TURN);
    const { t, number } = await setup('rdyok');
    arrange(number);
    const never = await p.api.as(t.admin).get(`/v2/calling/numbers/${number.uuid}/readiness`);
    expect(never.status).toBe(200);
    expect(never.body).toMatchObject({ status: 'never_checked', checks: [], checkedAt: null });

    const r = await check(t, number);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // Meta says calling is ENABLED already (switched on by hand over there): the local flag follows and the number is ready.
    expect(r.body).toMatchObject({
      status: 'ready',
      callingEnabled: true,
      metaCallingStatus: 'ENABLED',
      source: 'manual',
    });
    expect(states(r.body)).toEqual(
      Object.fromEntries(r.body.checks.map((c: { key: string }) => [c.key, 'ok'])),
    );
    expect(r.body.checks).toHaveLength(12);
    expect(await localFlag(number)).toBe(true);

    const one = await p.api.as(t.admin).get(`/v2/calling/numbers/${number.uuid}/readiness`);
    expect(one.body).toEqual(r.body);
    const list = await p.api.as(t.admin).get('/v2/calling/readiness');
    expect(list.body.rows).toEqual([r.body]);
    setIce(TURN);
  });

  it('reports ready_to_enable while Meta has calling off, and never switches it on by a check', async () => {
    setIce(TURN);
    const { t, number } = await setup('rdyoff');
    arrange(number, { calling: 'DISABLED' });
    const r = await check(t, number);
    expect(r.body).toMatchObject({
      status: 'ready_to_enable',
      callingEnabled: false,
      metaCallingStatus: 'DISABLED',
    });
    expect(codes(r.body).calling_enabled).toBe('calling_off');
    expect(p.meta.settings().filter((q) => q.method === 'POST')).toHaveLength(0);
    setIce(TURN);
  });
});

describe('every way a number is not ready', () => {
  it.each([
    ['a messaging limit under 2,000', { tier: 'TIER_250' }, 'messaging_limit', 'limit_low', 'fail'],
    [
      'a number that is not verified',
      { verification: 'NOT_VERIFIED' },
      'number_registered',
      'number_not_verified',
      'fail',
    ],
    [
      'a number Meta has not put live',
      { status: 'PENDING' },
      'number_registered',
      'number_not_live',
      'fail',
    ],
    [
      'a token missing the messaging permission',
      { scopes: ['whatsapp_business_management'] },
      'token_scopes',
      'scope_missing',
      'fail',
    ],
    [
      'a WABA nobody is subscribed to',
      { wabaApps: 0 },
      'webhook_subscribed',
      'waba_not_subscribed',
      'fail',
    ],
    [
      'a call icon hidden from customers',
      { icon: 'DISABLE_ALL' },
      'calling_enabled',
      'icon_hidden',
      'warn',
    ],
    [
      'a number on the WhatsApp Business app too',
      { platform: 'SMB_APP' },
      'not_coexistence',
      'coexistence',
      'fail',
    ],
    ['quality rated red', { quality: 'RED' }, 'messaging_limit', 'quality_low', 'warn'],
  ] as const)('%s', async (_what, world, key, code, state) => {
    const { t, number } = await setup('rdybad');
    arrange(number, world);
    const r = await check(t, number);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(codes(r.body)[key]).toBe(code);
    expect(states(r.body)[key]).toBe(state);
    expect(r.body.status).toBe(state === 'fail' ? 'blocked' : 'attention');
  });

  it('a local coexistence record refuses without waiting for Meta, and a disconnected number skips Meta', async () => {
    const co = await setup('rdyco', { meta: { coexistence: true } });
    arrange(co.number);
    expect(codes((await check(co.t, co.number)).body).not_coexistence).toBe('coexistence');

    const off = await setup('rdydis');
    await p.h.owner.query(`UPDATE wa_provider_configs SET status = 'disconnected' WHERE id = $1`, [
      off.number.configId,
    ]);
    arrange(off.number);
    const r = await check(off.t, off.number);
    expect(codes(r.body)).toMatchObject({
      connection: 'not_connected',
      number_registered: 'not_checked',
      calling_enabled: 'not_checked',
    });
    expect(r.body.status).toBe('blocked');
    expect(p.meta.requests).toHaveLength(0);
  });

  it('a token Meta rejects, and a read that fails, are rows of the checklist and not errors', async () => {
    const a = await setup('rdytok');
    arrange(a.number, {
      fail: {
        [`/${a.number.phoneNumberId}`]: metaError(190, 'Error validating access token', 401),
      },
    });
    const r = await check(a.t, a.number);
    expect(r.status).toBe(200);
    expect(codes(r.body)).toMatchObject({
      token_scopes: 'token_invalid',
      number_registered: 'meta_unreadable',
    });

    const b = await setup('rdy500');
    arrange(b.number, {
      fail: { [`/${b.number.phoneNumberId}/settings`]: { status: 500, json: {} } },
    });
    const rb = await check(b.t, b.number);
    expect(rb.status).toBe(200);
    expect(codes(rb.body).calling_enabled).toBe('meta_unreadable');
    expect(rb.body.metaCallingStatus).toBeNull();
  });
});

describe('a page that asks for a check by itself', () => {
  it('shares one look at Meta between two openings within a minute, while a click always looks', async () => {
    const { t, number } = await setup('rdythr');
    arrange(number);
    const first = await check(t, number, 'health');
    expect(first.status).toBe(200);
    const asked = p.meta.requests.length;
    expect(asked).toBeGreaterThan(0);
    const second = await check(t, number, 'health');
    expect(second.body).toEqual(first.body);
    expect(p.meta.requests).toHaveLength(asked);
    await check(t, number, 'manual');
    expect(p.meta.requests.length).toBeGreaterThan(asked);
  });
});

describe('the calls webhook field', () => {
  const subscriptionWrites = () =>
    p.meta.requests.filter((q) => q.method === 'POST' && q.path === '/1111/subscriptions');
  /** The check as the worker runs it: a system actor in the workspace, allowed to repair. */
  const asWorker = async (
    t: Tenant,
    n: CallNumber,
    source: 'connect' | 'schedule' = 'schedule',
  ) => {
    const svc = await readiness();
    return systemRun(t.orgId, () => svc.check(n.uuid, source, { repair: true }));
  };

  it('is read by a request and never rewritten by one: a missing field is a failure', async () => {
    const { t, number } = await setup('rdycalls');
    arrange(number, { appFields: ['messages', 'history'] });
    const r = await check(t, number);
    expect(codes(r.body).calls_field).toBe('calls_field_missing');
    expect(r.body.status).toBe('blocked');
    expect(subscriptionWrites()).toHaveLength(0);
  });

  it('is added by the worker, keeping what is there, and left alone once it is there', async () => {
    const { t, number } = await setup('rdyadd');
    arrange(number, { appFields: ['messages', 'history'] });
    const r = await asWorker(t, number, 'connect');
    expect(codes(r).calls_field).toBe('calls_field_added');
    const post = subscriptionWrites()[0]!;
    expect(String(post.body.fields).split(',').sort()).toEqual(['calls', 'history', 'messages']);
    expect(post.body.callback_url).toBe('https://platform.example.org/hook');
    arrange(number, { appFields: ['messages', 'history', 'calls'] });
    expect(codes(await asWorker(t, number)).calls_field).toBe('calls_field_ok');
    expect(subscriptionWrites()).toHaveLength(0);
  });

  it('is written by one worker at a time: with the lock held nothing is written', async () => {
    const { t, number } = await setup('rdylock');
    const { REDIS_CLIENT } = await import('../../../src/infra/redis/redis.module');
    const redis = p.h.app.get(REDIS_CLIENT, { strict: false });
    await redis.set('calling:calls-field-write', '1', 'EX', 30);
    try {
      arrange(number, { appFields: ['messages'] });
      expect(codes(await asWorker(t, number)).calls_field).toBe('calls_field_missing');
      expect(subscriptionWrites()).toHaveLength(0);
    } finally {
      await redis.del('calling:calls-field-write');
    }
    // The lock is released after a write too, so the next worker can write.
    arrange(number, { appFields: ['messages'] });
    expect(codes(await asWorker(t, number)).calls_field).toBe('calls_field_added');
    expect(await redis.get('calling:calls-field-write')).toBeNull();
  });

  it('is a failure, with nothing set on the platform app, when the app has no callback of its own', async () => {
    const { t, number } = await setup('rdynocb');
    arrange(number, { appFields: null });
    expect(codes(await asWorker(t, number)).calls_field).toBe('calls_field_missing');
    expect(subscriptionWrites()).toHaveLength(0);
  });

  it("is only a warning for a number on a customer's own Meta app, which this platform cannot read or change", async () => {
    const { t, number } = await setup('rdyown');
    arrange(number, { appId: '9999', appFields: ['messages'] });
    expect(codes(await asWorker(t, number)).calls_field).toBe('calls_field_unverifiable');
    expect(p.meta.requests.some((q) => q.path.endsWith('/subscriptions'))).toBe(false);
  });

  it("is unverifiable, and the platform app untouched, when the number's token cannot be tied to the platform app", async () => {
    const { t, number } = await setup('rdyunk');
    arrange(number, {
      appFields: ['messages'],
      fail: { '/debug_token': { status: 500, json: {} } },
    });
    const r = await asWorker(t, number);
    expect(codes(r).calls_field).toBe('calls_field_unverifiable');
    expect(codes(r).token_scopes).toBe('scopes_unverifiable');
    expect(p.meta.requests.some((q) => q.path.endsWith('/subscriptions'))).toBe(false);
  });
});

describe('the platform and the workspace', () => {
  it('warns about TURN: none, unfit, incomplete', async () => {
    const { t, number } = await setup('rdyturn');
    arrange(number);
    setIce('');
    expect(codes((await check(t, number)).body).turn).toBe('turn_missing');
    setIce('{not json');
    expect(codes((await check(t, number)).body).turn).toBe('ice_invalid');
    setIce(JSON.stringify([{ urls: 'turn:t.example.org' }]));
    expect(codes((await check(t, number)).body).turn).toBe('turn_incomplete');
    setIce(TURN);
    expect(
      (await check(t, number)).body.checks.find((c: { key: string }) => c.key === 'turn'),
    ).toMatchObject({ state: 'ok', code: 'turn_ok' });
    setIce(TURN);
  });

  it('counts the people who can call, and reads the recording rules', async () => {
    const { t, number } = await setup('rdypeople');
    arrange(number);
    const first = await check(t, number);
    expect(
      first.body.checks.find((c: { key: string }) => c.key === 'dialler_permissions'),
    ).toMatchObject({ state: 'ok', code: 'dialler_ok' });
    expect(codes(first.body).recording_consent).toBe('recording_off');
    await enableRecording(p, t);
    expect(codes((await check(t, number)).body).recording_consent).toBe('recording_configured');

    await p.h.owner.query(`UPDATE users SET status = 'suspended' WHERE org_id = $1`, [t.orgId]);
    const none = await check(t, number);
    expect(codes(none.body).dialler_permissions).toBe('dialler_none');
    expect(none.body.status).toBe('blocked');
  });

  it('without the plan feature says so, asks Meta about nothing and never switches anything on', async () => {
    const { t, number } = await setup('rdyplan');
    await setPlan(t, false);
    arrange(number, { calling: 'DISABLED' });
    // The setting is stored directly: the endpoint refuses it without the plan, but a row may predate a downgrade.
    await p.h.owner.query(
      `INSERT INTO wa_calling_settings (org_id, auto_enable_on_connect) VALUES ($1, true)`,
      [t.orgId],
    );
    const svc = await readiness();
    const r = await systemRun(t.orgId, () =>
      svc.check(number.uuid, 'connect', { autoEnable: true }),
    );
    expect(codes(r)).toMatchObject({
      plan_feature: 'plan_missing',
      connection: 'not_checked',
      calling_enabled: 'not_checked',
    });
    expect(r.status).toBe('blocked');
    expect(p.meta.requests).toHaveLength(0);
    expect(await localFlag(number)).toBe(false);

    const put = await p.api
      .as(t.admin)
      .put('/v2/calling/settings')
      .send({ autoEnableOnConnect: true, rowVersion: 1 });
    expect(put.status).toBe(422);
    expect(put.body.code).toBe('PLAN_FEATURE_LOCKED');
    // A workspace that lost the plan can still withdraw its say-so.
    const off = await p.api
      .as(t.admin)
      .put('/v2/calling/settings')
      .send({ autoEnableOnConnect: false, rowVersion: 1 });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.autoEnableOnConnect).toBe(false);
  });
});

describe('the switch follows Meta', () => {
  it('turns the local switch off when Meta says calling is off, and records it in the audit log', async () => {
    const { t, number } = await setup('rdydrift', { calling: true });
    arrange(number, { calling: 'DISABLED' });
    const before = await p.api.auditCount(t.orgId, 'wa_provider_configs', 'update');
    const r = await check(t, number);
    expect(r.body).toMatchObject({
      callingEnabled: false,
      metaCallingStatus: 'DISABLED',
      status: 'ready_to_enable',
    });
    expect(await localFlag(number)).toBe(false);
    expect(await p.api.auditCount(t.orgId, 'wa_provider_configs', 'update')).toBeGreaterThan(
      before,
    );
    const audit = await p.h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'wa_provider_configs' AND record_id = $2 ORDER BY id DESC`,
      [t.orgId, number.configId],
    );
    expect(audit.rows.some((a) => a.delta?.calling_enabled?.new === false)).toBe(true);
    // The Call button follows: eligibility reads the local switch.
    const list = await p.api.as(t.admin).get('/v2/calling/numbers');
    expect(list.body.rows[0].callingEnabled).toBe(false);
  });
});

describe('after a number is connected', () => {
  const connect = async (t: Tenant, n: CallNumber, w?: World) => {
    const world = arrange(n, w);
    const svc = await readiness();
    const r = await systemRun(t.orgId, () => svc.check(n.uuid, 'connect', { autoEnable: true }));
    return { r, world };
  };

  it('leaves calling off when the workspace has not opted in', async () => {
    const { t, number } = await setup('autooff');
    const { r } = await connect(t, number, { calling: 'DISABLED' });
    expect(r.status).toBe('ready_to_enable');
    expect(p.meta.settings().filter((q) => q.method === 'POST')).toHaveLength(0);
    expect(await localFlag(number)).toBe(false);
  });

  it('switches it on, audited, when the workspace opted in and nothing blocks the number', async () => {
    const { t, number } = await setup('autoon');
    const put = await p.api
      .as(t.admin)
      .put('/v2/calling/settings')
      .send({ autoEnableOnConnect: true });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body).toMatchObject({ autoEnableOnConnect: true, rowVersion: 1 });
    expect(await p.api.auditCount(t.orgId, 'wa_calling_settings', 'insert')).toBe(1);

    const { r } = await connect(t, number, { calling: 'DISABLED' });
    expect(r).toMatchObject({ status: 'ready', callingEnabled: true, source: 'connect' });
    const posts = p.meta.settings().filter((q) => q.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ calling: { status: 'ENABLED' } });
    expect(await localFlag(number)).toBe(true);
    const audit = await p.h.owner.query(
      `SELECT delta, actor_type FROM audit_log WHERE org_id = $1 AND module = 'wa_provider_configs' AND record_id = $2`,
      [t.orgId, number.configId],
    );
    expect(
      audit.rows.some((a) => a.delta?.calling_enabled?.new === true && a.actor_type === 'system'),
    ).toBe(true);
  });

  it('does not switch on a number whose Meta reads failed: a row nobody could read is not a pass', async () => {
    const { t, number } = await setup('autounread');
    await p.api.as(t.admin).put('/v2/calling/settings').send({ autoEnableOnConnect: true });
    const { r } = await connect(t, number, {
      calling: 'DISABLED',
      fail: { [`/${number.phoneNumberId}`]: { status: 500, json: {} } },
    });
    expect(codes(r).not_coexistence).toBe('meta_unreadable');
    expect(r.callingEnabled).toBe(false);
    expect(p.meta.settings().filter((q) => q.method === 'POST')).toHaveLength(0);
  });

  it("writes the switch only while it still reads what the check read, so a person's switch in between wins", async () => {
    const { t, number } = await setup('autorace', { calling: false });
    const { CallsRepository } = await import('../../../src/modules/calling-voice/calls.repository');
    const { DatabaseService } = await import('../../../src/infra/db/database.service');
    const db = p.h.app.get(DatabaseService, { strict: false });
    const repo = p.h.app.get(CallsRepository, { strict: false });
    const write = (from: boolean, to: boolean) =>
      db.txAs({ orgId: t.orgId }, (tx) =>
        repo.setCallingIf(tx, t.orgId, number.configId, from, to, {}),
      );
    // A person turned it on after the check read `false`: the check's write finds `true` and changes nothing.
    await p.h.owner.query(`UPDATE wa_provider_configs SET calling_enabled = true WHERE id = $1`, [
      number.configId,
    ]);
    expect(await write(false, false)).toBeNull();
    expect(await localFlag(number)).toBe(true);
    expect((await write(true, false))?.callingEnabled).toBe(false);
    expect(await localFlag(number)).toBe(false);
  });

  it('does not switch on a number that is blocked, and says why Meta refuses one it tried', async () => {
    const low = await setup('autolow');
    await p.api.as(low.t.admin).put('/v2/calling/settings').send({ autoEnableOnConnect: true });
    const a = await connect(low.t, low.number, { calling: 'DISABLED', tier: 'TIER_250' });
    expect(a.r.status).toBe('blocked');
    expect(p.meta.settings().filter((q) => q.method === 'POST')).toHaveLength(0);

    const refused = await setup('autoref');
    await p.api.as(refused.t.admin).put('/v2/calling/settings').send({ autoEnableOnConnect: true });
    arrange(refused.number, { calling: 'DISABLED' });
    p.meta.answer((req) =>
      req.method === 'POST' && req.path.endsWith('/settings')
        ? metaError(100, 'Calling pre-requisite not met')
        : undefined,
    );
    const svc = await readiness();
    const r = await systemRun(refused.t.orgId, () =>
      svc.check(refused.number.uuid, 'connect', { autoEnable: true }),
    );
    expect(r.status).toBe('ready_to_enable');
    expect(r.checks.find((c) => c.key === 'calling_enabled')).toMatchObject({
      code: 'calling_off',
      params: { refused: 'prerequisites' },
    });
    expect(await localFlag(refused.number)).toBe(false);
  });

  it('is queued by the connect event of the WABA domain, once per event, and run by the worker', async () => {
    const { t, number } = await setup('evt');
    arrange(number, { calling: 'DISABLED' });
    const { OutboxSubscriberRegistry } =
      await import('../../../src/kernel/outbox/outbox-subscribers');
    const { getQueueToken } = await import('@nestjs/bullmq');
    const { QUEUES } = await import('../../../src/infra/queue/queues');
    const queue = p.h.app.get(getQueueToken(QUEUES.CALLING_READINESS), { strict: false });
    const event = {
      id: `evt-${Date.now()}`,
      orgId: t.orgId,
      aggregateModule: 'wa_provider_configs',
      aggregateId: String(number.configId),
      eventType: 'whatsapp.connection.connected',
      payload: { connectionId: number.uuid },
    };
    const registry = p.h.app.get(OutboxSubscriberRegistry, { strict: false });
    await registry.dispatch(event);
    await registry.dispatch(event);
    const job = await queue.getJob(`calling-readiness-connect-${event.id}`);
    expect(job?.data).toEqual({ orgId: t.orgId, numberUuid: number.uuid, source: 'connect' });
    expect(job?.delay).toBeGreaterThan(0);
    // Skip the wait Meta needs: the worker takes it now.
    await job!.promote();
    const deadline = Date.now() + 20_000;
    let stored: string | undefined;
    while (Date.now() < deadline && !stored) {
      const res = await p.h.owner.query(
        `SELECT source FROM wa_calling_readiness WHERE org_id = $1`,
        [t.orgId],
      );
      stored = res.rows[0]?.source;
      if (!stored) await new Promise((r) => setTimeout(r, 250));
    }
    expect(stored).toBe('connect');
  });

  it('is not queued for a workspace whose plan has no calling', async () => {
    const { t, number } = await setup('evtplan');
    await setPlan(t, false);
    const { OutboxSubscriberRegistry } =
      await import('../../../src/kernel/outbox/outbox-subscribers');
    const { getQueueToken } = await import('@nestjs/bullmq');
    const { QUEUES } = await import('../../../src/infra/queue/queues');
    const queue = p.h.app.get(getQueueToken(QUEUES.CALLING_READINESS), { strict: false });
    const id = `evtp-${Date.now()}`;
    await p.h.app.get(OutboxSubscriberRegistry, { strict: false }).dispatch({
      id,
      orgId: t.orgId,
      aggregateModule: 'wa_provider_configs',
      aggregateId: String(number.configId),
      eventType: 'whatsapp.connection.connected',
      payload: { connectionId: number.uuid },
    });
    expect(await queue.getJob(`calling-readiness-connect-${id}`)).toBeFalsy();
  });
});

describe('the schedule', () => {
  it('takes the numbers that are due, never switches calling on, and skips numbers nobody prepared', async () => {
    const { CallingReadinessScheduler } =
      await import('../../../src/modules/calling-voice/calling-readiness.jobs');
    const scheduler = p.h.app.get(CallingReadinessScheduler, { strict: false });
    const { getQueueToken } = await import('@nestjs/bullmq');
    const { QUEUES } = await import('../../../src/infra/queue/queues');
    const queue = p.h.app.get(getQueueToken(QUEUES.CALLING_READINESS), { strict: false });

    const on = await setup('schon', { calling: true });
    const idle = await setup('schidle');
    const prepared = await setup('schprep');
    arrange(prepared.number, { calling: 'DISABLED' });
    await check(prepared.t, prepared.number);
    await p.api
      .as(prepared.t.admin)
      .put('/v2/calling/settings')
      .send({ autoEnableOnConnect: true });
    await p.h.owner.query(
      `UPDATE wa_calling_readiness SET next_check_at = now() - interval '1 minute' WHERE org_id = $1`,
      [prepared.t.orgId],
    );

    const queued = await scheduler.enqueueDue();
    expect(queued).toBeGreaterThanOrEqual(2);
    const window = Math.floor(Date.now() / SCHEDULE_TICK_MS);
    expect(
      (await queue.getJob(`calling-readiness-sched-${on.number.uuid}-${window}`))?.data,
    ).toMatchObject({ source: 'schedule', orgId: on.t.orgId });
    expect(
      await queue.getJob(`calling-readiness-sched-${prepared.number.uuid}-${window}`),
    ).toBeTruthy();
    expect(await queue.getJob(`calling-readiness-sched-${idle.number.uuid}-${window}`)).toBeFalsy();

    // The scheduled look is a look: the opt-in does not make it switch calling on.
    arrange(prepared.number, { calling: 'DISABLED' });
    const svc = await readiness();
    const r = await systemRun(prepared.t.orgId, () =>
      svc.check(prepared.number.uuid, 'schedule', {}),
    );
    expect(r.callingEnabled).toBe(false);
    expect(p.meta.settings().filter((q) => q.method === 'POST')).toHaveLength(0);
    // Looked at, so no longer due.
    const due = await p.h.owner.query(
      `SELECT next_check_at > now() AS later FROM wa_calling_readiness WHERE org_id = $1`,
      [prepared.t.orgId],
    );
    expect(due.rows[0].later).toBe(true);
  });
});

describe('a switch-on after a connect that does not happen at once', () => {
  const row = async (t: Tenant) =>
    (
      await p.h.owner.query(
        `SELECT auto_enable_pending AS pending, auto_enable_attempts AS attempts,
                (next_check_at - now()) AS wait, source
           FROM wa_calling_readiness WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows[0] as { pending: boolean; attempts: number; wait: { minutes?: number }; source: string };
  const asSystem = async (t: Tenant, n: CallNumber, source: 'connect' | 'schedule') => {
    const svc = await readiness();
    return systemRun(t.orgId, () =>
      svc.check(n.uuid, source, { autoEnable: source === 'connect' }),
    );
  };
  const optIn = (t: Tenant) =>
    p.api.as(t.admin).put('/v2/calling/settings').send({ autoEnableOnConnect: true });

  it('stays pending when Meta cannot be read, looks again in 1, 5 and 15 minutes, and then switches on', async () => {
    const { t, number } = await setup('pend1');
    await optIn(t);
    const down = { fail: { [`/${number.phoneNumberId}/settings`]: { status: 500, json: {} } } };
    arrange(number, { calling: 'DISABLED', ...down });
    expect((await asSystem(t, number, 'connect')).callingEnabled).toBe(false);
    let r = await row(t);
    expect(r).toMatchObject({ pending: true, attempts: 1 });
    expect(r.wait.minutes ?? 0).toBeLessThanOrEqual(1);
    // The schedule keeps trying while it is pending, and the rhythm lengthens: 5, then 15, then the normal one.
    for (const [attempts, minutes] of [
      [2, 5],
      [3, 15],
    ] as const) {
      await asSystem(t, number, 'schedule');
      r = await row(t);
      expect(r.attempts).toBe(attempts);
      expect(r.wait.minutes ?? 0).toBeLessThanOrEqual(minutes);
      expect(r.wait.minutes ?? 0).toBeGreaterThanOrEqual(minutes - 1);
    }
    await asSystem(t, number, 'schedule');
    expect((await row(t)).wait.minutes).toBeGreaterThan(15);
    expect(p.meta.settings().filter((q) => q.method === 'POST')).toHaveLength(0);
    // Meta can be read: the next check, a scheduled one, switches it on and the pending mark ends.
    arrange(number, { calling: 'DISABLED' });
    const done = await asSystem(t, number, 'schedule');
    expect(done).toMatchObject({ callingEnabled: true, source: 'schedule' });
    expect(await row(t)).toMatchObject({ pending: false, attempts: 0 });
    expect(await localFlag(number)).toBe(true);
  });

  it("stays pending while something blocks the number, and switches on when it is put right, by a person's check too", async () => {
    const { t, number } = await setup('pend2');
    await optIn(t);
    arrange(number, { calling: 'DISABLED', tier: 'TIER_250' });
    expect((await asSystem(t, number, 'connect')).status).toBe('blocked');
    expect((await row(t)).pending).toBe(true);
    arrange(number, { calling: 'DISABLED' });
    const r = await check(t, number);
    expect(r.body).toMatchObject({ callingEnabled: true, status: 'ready' });
    expect((await row(t)).pending).toBe(false);
  });

  it('stays pending after Meta refuses, and is withdrawn by the setting, the plan or a person turning calling off', async () => {
    const refusing = await setup('pend3');
    await optIn(refusing.t);
    arrange(refusing.number, { calling: 'DISABLED' });
    p.meta.answer((req) =>
      req.method === 'POST' && req.path.endsWith('/settings')
        ? metaError(100, 'Calling pre-requisite not met')
        : undefined,
    );
    await asSystem(refusing.t, refusing.number, 'connect');
    expect((await row(refusing.t)).pending).toBe(true);

    // The workspace turns the setting off: the next look withdraws it and switches nothing on.
    await p.api
      .as(refusing.t.admin)
      .put('/v2/calling/settings')
      .send({ autoEnableOnConnect: false, rowVersion: 1 });
    arrange(refusing.number, { calling: 'DISABLED' });
    await asSystem(refusing.t, refusing.number, 'schedule');
    expect(await row(refusing.t)).toMatchObject({ pending: false });
    expect(await localFlag(refusing.number)).toBe(false);

    const noPlan = await setup('pend4');
    await optIn(noPlan.t);
    arrange(noPlan.number, { calling: 'DISABLED', tier: 'TIER_250' });
    await asSystem(noPlan.t, noPlan.number, 'connect');
    expect((await row(noPlan.t)).pending).toBe(true);
    await setPlan(noPlan.t, false);
    await asSystem(noPlan.t, noPlan.number, 'schedule');
    expect((await row(noPlan.t)).pending).toBe(false);

    const person = await setup('pend5');
    await optIn(person.t);
    arrange(person.number, { calling: 'DISABLED', tier: 'TIER_250' });
    await asSystem(person.t, person.number, 'connect');
    expect((await row(person.t)).pending).toBe(true);
    // A person turning calling off (the toggle) withdraws it, even though calling was already off.
    p.meta.reset();
    expect(
      (
        await p.api
          .as(person.t.admin)
          .post(`/v2/calling/numbers/${person.number.uuid}/toggle`)
          .send({ enable: false })
      ).status,
    ).toBe(200);
    expect((await row(person.t)).pending).toBe(false);
  });
});

describe('a check that must not fail for what Meta or Redis do', () => {
  it('answers with the row "could not be verified" when Redis fails on the lock or the field cannot be read', async () => {
    const { t, number } = await setup('nofail');
    const { REDIS_CLIENT } = await import('../../../src/infra/redis/redis.module');
    const redis = p.h.app.get(REDIS_CLIENT, { strict: false });
    arrange(number, { appFields: ['messages'] });
    const svc = await readiness();
    const spy = vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('redis down'));
    try {
      const r = await systemRun(t.orgId, () =>
        svc.check(number.uuid, 'schedule', { repair: true }),
      );
      expect(codes(r).calls_field).toBe('calls_field_unverifiable');
    } finally {
      spy.mockRestore();
    }
    arrange(number, {
      appFields: ['messages'],
      fail: { '/1111/subscriptions': { status: 500, json: {} } },
    });
    const r2 = await systemRun(t.orgId, () => svc.check(number.uuid, 'schedule', { repair: true }));
    expect(['calls_field_unverifiable', 'calls_field_missing']).toContain(codes(r2).calls_field);
  });

  it('releases the lock only if it is still its own', async () => {
    const { t, number } = await setup('lockown');
    const { REDIS_CLIENT } = await import('../../../src/infra/redis/redis.module');
    const redis = p.h.app.get(REDIS_CLIENT, { strict: false });
    arrange(number, { appFields: ['messages'] });
    // Another worker holds the lock under its own token: this worker writes nothing and leaves the other's lock alone.
    await redis.set('calling:calls-field-write', 'someone-else', 'EX', 30);
    try {
      const svc = await readiness();
      await systemRun(t.orgId, () => svc.check(number.uuid, 'schedule', { repair: true }));
      expect(await redis.get('calling:calls-field-write')).toBe('someone-else');
    } finally {
      await redis.del('calling:calls-field-write');
    }
  });

  it('stores results in order: a check that finished earlier does not overwrite a later one', async () => {
    const { t, number } = await setup('order');
    const { CallingReadinessRepository } =
      await import('../../../src/modules/calling-voice/calling-readiness.repository');
    const { DatabaseService } = await import('../../../src/infra/db/database.service');
    const db = p.h.app.get(DatabaseService, { strict: false });
    const repo = p.h.app.get(CallingReadinessRepository, { strict: false });
    const save = (status: 'ready' | 'blocked', at: Date) =>
      db.txAs({ orgId: t.orgId }, (tx) =>
        repo.save(tx, t.orgId, number.configId, {
          status,
          checks: [],
          metaStatus: null,
          source: 'manual',
          checkedAt: at,
          nextCheckAt: new Date(at.getTime() + 60_000),
          autoEnablePending: false,
          autoEnableAttempts: 0,
        }),
      );
    const later = new Date();
    const earlier = new Date(later.getTime() - 5_000);
    expect(await save('ready', later)).toBe(true);
    expect(await save('blocked', earlier)).toBe(false);
    const stored = await p.h.owner.query(
      `SELECT status FROM wa_calling_readiness WHERE org_id = $1`,
      [t.orgId],
    );
    expect(stored.rows[0].status).toBe('ready');
  });

  it('does not overwrite a switch written after the check began, even with the same value', async () => {
    const { t, number } = await setup('since', { calling: false });
    const { CallsRepository } = await import('../../../src/modules/calling-voice/calls.repository');
    const { DatabaseService } = await import('../../../src/infra/db/database.service');
    const db = p.h.app.get(DatabaseService, { strict: false });
    const repo = p.h.app.get(CallsRepository, { strict: false });
    const began = new Date(Date.now() - 60_000);
    // The number was touched after `began` (a toggle): the check's write finds it changed and does nothing.
    await p.h.owner.query(`UPDATE wa_provider_configs SET display_label = 'x' WHERE id = $1`, [
      number.configId,
    ]);
    const r = await db.txAs({ orgId: t.orgId }, (tx) =>
      repo.setCallingIf(tx, t.orgId, number.configId, false, true, {}, began),
    );
    expect(r).toBeNull();
    expect(await localFlag(number)).toBe(false);
  });
});

describe('the schedule claims what it takes', () => {
  it('does not take the same number twice, and gives claimed numbers back when they cannot be queued', async () => {
    const { CallingReadinessScheduler } =
      await import('../../../src/modules/calling-voice/calling-readiness.jobs');
    const { CallingReadinessRepository } =
      await import('../../../src/modules/calling-voice/calling-readiness.repository');
    const { DatabaseService } = await import('../../../src/infra/db/database.service');
    const { getQueueToken } = await import('@nestjs/bullmq');
    const { QUEUES } = await import('../../../src/infra/queue/queues');
    const scheduler = p.h.app.get(CallingReadinessScheduler, { strict: false });
    const repo = p.h.app.get(CallingReadinessRepository, { strict: false });
    const db = p.h.app.get(DatabaseService, { strict: false });
    const queue = p.h.app.get(getQueueToken(QUEUES.CALLING_READINESS), { strict: false });

    const { t, number } = await setup('claim', { calling: true });
    const mine = (rows: Array<{ orgId: number; uuid: string }>) =>
      rows.filter((r) => r.uuid === number.uuid);
    // Two takers at once: only one gets the number.
    const [a, b] = await Promise.all([
      db.privileged((tx) => repo.due(tx, 500)),
      db.privileged((tx) => repo.due(tx, 500)),
    ]);
    expect(mine(a).length + mine(b).length).toBe(1);
    expect(mine(await db.privileged((tx) => repo.due(tx, 500)))).toHaveLength(0);

    // Queueing fails: the claim is given back, and the failure is not swallowed.
    await p.h.owner.query(
      `UPDATE wa_calling_readiness SET next_check_at = now() - interval '1 minute' WHERE org_id = $1`,
      [t.orgId],
    );
    const add = vi.spyOn(queue, 'addBulk').mockRejectedValueOnce(new Error('redis down'));
    try {
      await expect(scheduler.enqueueDue()).rejects.toThrow('redis down');
    } finally {
      add.mockRestore();
    }
    const after = await p.h.owner.query(
      `SELECT next_check_at <= now() AS due FROM wa_calling_readiness WHERE org_id = $1`,
      [t.orgId],
    );
    expect(after.rows[0].due).toBe(true);
  });
});

describe('who may see and change it, and whose it is', () => {
  it('lets a caller read it, keeps checking and the setting for those who manage calling, and answers 403 to the rest', async () => {
    const { t, number } = await setup('rdyperm');
    arrange(number);
    const caller = await p.api.member(t, 'dial', [['call.calls.use']]);
    const manager = await p.api.member(t, 'mgr', [['call.calls.use'], ['call.calling.manage']]);
    const nobody = await p.api.member(t, 'nobody', []);

    expect((await p.api.as(caller.token).get('/v2/calling/readiness')).status).toBe(200);
    expect(
      (await p.api.as(caller.token).get(`/v2/calling/numbers/${number.uuid}/readiness`)).status,
    ).toBe(200);
    expect((await p.api.as(caller.token).get('/v2/calling/settings')).status).toBe(200);
    expect(
      (
        await p.api
          .as(caller.token)
          .post(`/v2/calling/numbers/${number.uuid}/readiness/check`)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (await p.api.as(caller.token).put('/v2/calling/settings').send({ autoEnableOnConnect: true }))
        .status,
    ).toBe(403);
    expect(p.meta.requests).toHaveLength(0);

    for (const path of [
      '/v2/calling/readiness',
      `/v2/calling/numbers/${number.uuid}/readiness`,
      '/v2/calling/settings',
    ]) {
      expect((await p.api.as(nobody.token).get(path)).status, path).toBe(403);
    }
    expect(
      (
        await p.api
          .as(manager.token)
          .post(`/v2/calling/numbers/${number.uuid}/readiness/check`)
          .send({ source: 'health' })
      ).status,
    ).toBe(200);
    expect(
      (
        await p.api
          .as(manager.token)
          .put('/v2/calling/settings')
          .send({ autoEnableOnConnect: true })
      ).status,
    ).toBe(200);
  });

  it('is invisible to another workspace', async () => {
    const mine = await setup('rdyiso');
    arrange(mine.number);
    await check(mine.t, mine.number);
    const other = await p.api.signup('rdyother');
    const theirs = await addNumber(p, other, { calling: false });
    for (const r of [
      await p.api.as(other.admin).get(`/v2/calling/numbers/${mine.number.uuid}/readiness`),
      await p.api
        .as(other.admin)
        .post(`/v2/calling/numbers/${mine.number.uuid}/readiness/check`)
        .send({}),
    ]) {
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('CALL_NUMBER_NOT_FOUND');
    }
    const list = await p.api.as(other.admin).get('/v2/calling/readiness');
    expect(list.body.rows.map((x: { numberId: string }) => x.numberId)).toEqual([theirs.uuid]);
    expect(
      await p.h.owner.query(
        `SELECT count(*)::int AS n FROM wa_calling_readiness WHERE org_id = $1`,
        [other.orgId],
      ),
    ).toMatchObject({ rows: [{ n: 0 }] });
  });

  it('refuses a stale setting and a first save that names a version', async () => {
    const { t } = await setup('rdyset');
    expect(
      (
        await p.api
          .as(t.admin)
          .put('/v2/calling/settings')
          .send({ autoEnableOnConnect: true, rowVersion: 1 })
      ).status,
    ).toBe(409);
    const first = await p.api
      .as(t.admin)
      .put('/v2/calling/settings')
      .send({ autoEnableOnConnect: true });
    expect(first.status).toBe(200);
    expect(
      (await p.api.as(t.admin).put('/v2/calling/settings').send({ autoEnableOnConnect: false }))
        .status,
    ).toBe(409);
    const second = await p.api
      .as(t.admin)
      .put('/v2/calling/settings')
      .send({ autoEnableOnConnect: false, rowVersion: first.body.rowVersion });
    expect(second.body).toMatchObject({ autoEnableOnConnect: false });
    expect(await p.api.auditCount(t.orgId, 'wa_calling_settings', 'update')).toBe(1);
  });
});

describe("Meta's refusals reach the web as reasons", () => {
  it('on the switch: prerequisite, coexistence and a rejected token, each as a code and not by wording', async () => {
    const { t, number } = await setup('rsnsw');
    const toggle = () =>
      p.api.as(t.admin).post(`/v2/calling/numbers/${number.uuid}/toggle`).send({ enable: true });
    const reason = (body: { errors?: Array<{ path: string; message: string }> }) =>
      body.errors?.find((d) => d.path === 'reason')?.message;
    for (const [answer, expected] of [
      [metaError(100, 'Calling pre-requisite not met'), 'prerequisites'],
      [metaError(141000, 'Not a cloud api number'), 'coexistence'],
      [metaError(190, 'Error validating access token', 401), 'token_expired'],
      [
        metaError(10, 'Application does not have permission for this action', 403),
        'permission_scope',
      ],
    ] as const) {
      p.meta.reset();
      p.meta.answer((req) => (req.path.endsWith('/settings') ? answer : undefined));
      const r = await toggle();
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('CALL_META_REFUSED');
      expect(reason(r.body), JSON.stringify(r.body)).toBe(expected);
    }
  });

  it('on the call: a customer who cannot receive calls', async () => {
    const { t, number } = await setup('rsncall', { calling: true });
    p.meta.reset();
    await deliver(p, number, {
      event: 'permission_update',
      from: '919811100077',
      response: 'accept',
      expiration_timestamp: Math.floor(Date.now() / 1000) + 86400,
    });
    p.meta.answer((req) =>
      req.path.endsWith('/calls') ? metaError(138001, 'Receiver uncallable') : undefined,
    );
    const r = await p.api
      .as(t.admin)
      .post('/v2/calling/calls/dial')
      .send({ numberId: number.uuid, to: '919811100077', sdpOffer: SDP_OFFER });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('CALL_META_REFUSED');
    expect(r.body.errors).toContainEqual({ path: 'reason', message: 'receiver_uncallable' });
  });

  it('the permission code of Meta (138006) asks the customer instead of failing', async () => {
    const { t, number } = await setup('rsnperm', { calling: true });
    p.meta.reset();
    await deliver(p, number, {
      event: 'permission_update',
      from: '919811100078',
      response: 'accept',
      expiration_timestamp: Math.floor(Date.now() / 1000) + 86400,
    });
    p.meta.answer((req) =>
      req.path.endsWith('/calls')
        ? metaError(138006, 'No approved call permission from this user')
        : undefined,
    );
    const r = await p.api
      .as(t.admin)
      .post('/v2/calling/calls/dial')
      .send({ numberId: number.uuid, to: '919811100078', sdpOffer: SDP_OFFER });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('CALL_PERMISSION_REQUESTED');
    expect(p.meta.messages()).toHaveLength(1);
  });

  it('switching calling on and off through the toggle is audited', async () => {
    const { t, number } = await setup('rsnaud');
    arrange(number, { calling: 'DISABLED' });
    const before = await p.api.auditCount(t.orgId, 'wa_provider_configs', 'update');
    expect(
      (
        await p.api
          .as(t.admin)
          .post(`/v2/calling/numbers/${number.uuid}/toggle`)
          .send({ enable: true })
      ).status,
    ).toBe(200);
    expect(await p.api.auditCount(t.orgId, 'wa_provider_configs', 'update')).toBe(before + 1);
    // And the check that follows a person turning it on keeps the result.
    const r = await check(t, number, 'enable');
    expect(r.body).toMatchObject({ source: 'enable', callingEnabled: true });
  });
});
