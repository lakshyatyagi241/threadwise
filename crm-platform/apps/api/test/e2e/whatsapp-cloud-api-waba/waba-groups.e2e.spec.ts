import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { WabaHttp } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { startPipeline, until, type Pipeline } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import { FakeWabaGroupsGateway } from '../../support/fake-waba-groups-gateway';

/**
 * WhatsApp Cloud API groups, the management side (BL-094 phases 1 and 2), end to end: the real API, a real Postgres and Redis, the real
 * WABA ingest for the webhooks. Meta is FAKED at the HTTP edge (`FakeWabaGroupsGateway`): nothing here has run against real Meta, there is
 * no Official Business Account to test with (BL-030).
 */
let p: Pipeline;
const gw = new FakeWabaGroupsGateway();
let seq = 0;
let ingest: { process: (changes: unknown[]) => Promise<unknown> };
let split: (payload: unknown) => unknown[];
let links: {
  ensure: (
    orgId: number,
    configId: number,
    o: { create: boolean },
  ) => Promise<{ id: number } | null>;
};

beforeAll(async () => {
  p = await startPipeline();
  const { WabaIngestService } =
    await import('../../../src/modules/whatsapp-cloud-api-waba/waba-ingest.service');
  const { splitWebhook } = await import('../../../src/modules/whatsapp-cloud-api-waba/waba-rules');
  const { WabaChannelLinkService } =
    await import('../../../src/modules/chat-conversations/waba-channel-link.service');
  ingest = p.h.app.get(WabaIngestService) as never;
  split = splitWebhook as never;
  links = p.h.app.get(WabaChannelLinkService, { strict: false }) as never;
  p.h.app.get(WabaHttp).fetchImpl = gw.fetch;
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

beforeEach(() => gw.reset());

interface Arranged {
  t: Tenant;
  id: string;
  configId: number;
  phoneNumberId: string;
  wabaId: string;
  base: string;
}

/** A workspace with a connected number on the Meta route and a plan that includes the feature. */
async function arrange(
  label: string,
  opts: { provider?: 'meta' | 'interakt'; plan?: boolean } = {},
): Promise<Arranged> {
  const t = await p.api.signup(label);
  const n = seq++;
  const phoneNumberId = `6100${n}00`;
  const wabaId = `77${phoneNumberId}`;
  const crypto = p.h.app.get(CryptoService);
  const provider = opts.provider ?? 'meta';
  const row = (
    await p.h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, is_primary, phone_number, display_label, credentials_json, meta_json, connected_at)
       VALUES ($1, 'waba', 'connected', true, $2, 'Group line', $3, $4, now()) RETURNING id, uuid`,
      [
        t.orgId,
        `+9191144${String(10000 + n)}`,
        crypto.encrypt(
          JSON.stringify(
            provider === 'interakt' ? { auth_key: 'ik-key' } : { access_token: `EAAG-grp-${n}` },
          ),
        ),
        JSON.stringify({
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          provider,
          is_official_business_account: true,
        }),
      ],
    )
  ).rows[0];
  if (opts.plan !== false) {
    await p.h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      t.orgId,
      JSON.stringify({ features: { waba_groups: true } }),
    ]);
  }
  const configId = Number(row.id);
  await links.ensure(t.orgId, configId, { create: true });
  const id = row.uuid as string;
  return { t, id, configId, phoneNumberId, wabaId, base: `/v2/waba/numbers/${id}/groups` };
}

const feed = (x: Arranged, field: string, value: Record<string, unknown>) =>
  ingest.process(
    split({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: x.wabaId,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field,
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: x.phoneNumberId },
                ...value,
              },
            },
          ],
        },
      ],
    }),
  );

const rowOf = async (orgId: number, uuid: string) =>
  (
    await p.h.owner.query(`SELECT * FROM waba_groups WHERE org_id = $1 AND uuid = $2`, [
      orgId,
      uuid,
    ])
  ).rows[0] as Record<string, unknown> | undefined;
const outbox = async (orgId: number, type: string) =>
  (
    await p.h.owner.query(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
      [orgId, type],
    )
  ).rows.map((r) => r.payload as Record<string, unknown>);
const audits = async (orgId: number) =>
  (
    await p.h.owner.query(
      `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'waba_groups' ORDER BY id`,
      [orgId],
    )
  ).rows as Array<{ action: string; delta: Record<string, { old: unknown; new: unknown }> | null }>;

async function createGroup(x: Arranged, body: Record<string, unknown> = { subject: 'VIP' }) {
  const res = await p.api.as(x.t.admin).post(x.base).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; groupId: string } & Record<string, unknown>;
}

describe('the plan gate (owner decision 2026-10-08: not in every plan)', () => {
  it('a workspace on a plan without waba_groups is refused 422 PLAN_FEATURE_LOCKED on every route, reads included; one with it passes', async () => {
    const own = await arrange('gp-own');
    const locked = await arrange('gp-lock', { plan: false });
    await p.h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      locked.t.orgId,
      JSON.stringify({ features: { waba_groups: false } }),
    ]);
    const g = await createGroup(own);
    const nil = '00000000-0000-4000-8000-000000000000';
    for (const [method, path] of [
      ['get', `${locked.base}/state`],
      ['get', locked.base],
      ['post', locked.base],
      ['post', `${locked.base}/${nil}/refresh`],
      ['post', `${locked.base}/${nil}/invite-link/reset`],
      ['patch', `${locked.base}/${nil}`],
      ['post', `${locked.base}/${nil}/join-requests`],
      ['get', `${locked.base}/${nil}/participants`],
      ['delete', `${locked.base}/${nil}/participants`],
      ['delete', `${locked.base}/${nil}`],
    ] as const) {
      const res = await p.api.as(locked.t.admin)[method](path).send({});
      expect(res.status, `${method} ${path}`).toBe(422);
      expect(res.body.code, path).toBe('PLAN_FEATURE_LOCKED');
    }
    expect((await p.api.as(own.t.admin).get(own.base)).status).toBe(200);
    // A lapse takes it away again, the data stays.
    await p.h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      own.t.orgId,
      JSON.stringify({ features: { waba_groups: false } }),
    ]);
    expect((await p.api.as(own.t.admin).get(own.base)).body.code).toBe('PLAN_FEATURE_LOCKED');
    expect(await rowOf(own.t.orgId, g.id)).toBeDefined();
  });
});

describe('eligibility and the provider route', () => {
  it('reports eligible, remembers the answer, and asks Meta again with fresh=1', async () => {
    const x = await arrange('el1');
    const first = await p.api.as(x.t.admin).get(`${x.base}/state`);
    expect(first.body).toEqual({
      eligible: true,
      reason: 'eligible',
      provider: 'meta',
      officialBusinessAccount: true,
    });
    await p.api.as(x.t.admin).get(`${x.base}/state`);
    expect(gw.callsTo(/GET \/.*\/groups$/)).toHaveLength(1);
    gw.eligible = false;
    expect((await p.api.as(x.t.admin).get(`${x.base}/state`)).body.eligible).toBe(true);
    const fresh = await p.api.as(x.t.admin).get(`${x.base}/state?fresh=1`);
    expect(fresh.body).toMatchObject({ eligible: false, reason: 'not_eligible' });
  });

  it('does not remember a failed check (only 131215 is a definite no)', async () => {
    const x = await arrange('el2');
    gw.failWith(/GET \/.*\/groups$/, 131208, 'slow', 429);
    const res = await p.api.as(x.t.admin).get(`${x.base}/state`);
    expect(res.body).toMatchObject({ eligible: true, reason: 'check_failed' });
    const again = await p.api.as(x.t.admin).get(`${x.base}/state`);
    expect(again.body.reason).toBe('eligible');
  });

  it('a mutation Meta answers 131215 to is WABA_GROUPS_NOT_ELIGIBLE and the screen state follows', async () => {
    const x = await arrange('el3');
    gw.failWith(/POST/, 131215, 'dev text', 400);
    const res = await p.api.as(x.t.admin).post(x.base).send({ subject: 'A' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WABA_GROUPS_NOT_ELIGIBLE');
    expect((await p.api.as(x.t.admin).get(`${x.base}/state`)).body.reason).toBe('not_eligible');
  });

  it('a number reached through Interakt answers WABA_GROUPS_PROVIDER_UNSUPPORTED and Meta is never called', async () => {
    const x = await arrange('el4', { provider: 'interakt' });
    expect((await p.api.as(x.t.admin).get(`${x.base}/state`)).body).toMatchObject({
      eligible: false,
      reason: 'provider_unsupported',
      provider: 'interakt',
    });
    const res = await p.api.as(x.t.admin).post(x.base).send({ subject: 'A' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WABA_GROUPS_PROVIDER_UNSUPPORTED');
    expect(gw.calls).toHaveLength(0);
  });
});

describe('create, the invite link webhook and the list', () => {
  it('creates on Meta, stores the row without a link, writes audit and the created event, then the webhook fills the link', async () => {
    const x = await arrange('cr1');
    const g = await createGroup(x, {
      subject: ' VIP customers ',
      description: 'Best ones',
      joinApprovalMode: 'approval_required',
    });
    expect(g).toMatchObject({
      subject: ' VIP customers '.trim(),
      awaitingInviteLink: true,
      inviteLink: null,
      joinApprovalMode: 'approval_required',
      participantCount: 0,
    });
    expect(gw.calls[0]!.body).toMatchObject({
      subject: 'VIP customers',
      description: 'Best ones',
      join_approval_mode: 'approval_required',
    });
    const row = await rowOf(x.t.orgId, g.id);
    expect(row).toMatchObject({ group_id: g.groupId });
    expect(Number(row!.created_by_user_id)).toBe(x.t.adminUserId);
    expect(await outbox(x.t.orgId, 'whatsapp.group.created')).toHaveLength(1);
    const log = await audits(x.t.orgId);
    expect(log).toHaveLength(1);
    expect(log[0]!.action).toBe('insert');
    expect(JSON.stringify(log[0]!.delta)).toContain('waba.group.create');

    await feed(x, 'group_lifecycle_update', {
      groups: [
        {
          group_id: g.groupId,
          type: 'group_create',
          subject: 'VIP customers',
          invite_link: 'https://chat.whatsapp.com/abc',
          timestamp: 1_700_000_000,
        },
      ],
    });
    const list = await p.api.as(x.t.admin).get(x.base);
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({
      inviteLink: 'https://chat.whatsapp.com/abc',
      awaitingInviteLink: false,
    });
    expect(list.body.stats).toEqual({ groups: 1, members: 0, joinRequests: 0, suspended: 0 });
    expect((await outbox(x.t.orgId, 'whatsapp.group.updated')).length).toBeGreaterThan(0);
  });

  it('validates at the door: a blank name, 129 characters and a 2049-character description never reach Meta', async () => {
    const x = await arrange('cr2');
    for (const body of [
      { subject: '   ' },
      { subject: 'x'.repeat(129) },
      { subject: 'ok', description: 'd'.repeat(2049) },
      { subject: 'ok', joinApprovalMode: 'anyone' },
    ]) {
      const res = await p.api.as(x.t.admin).post(x.base).send(body);
      expect(res.status).toBe(422);
    }
    expect(
      (
        await p.api
          .as(x.t.admin)
          .post(x.base)
          .send({ subject: 'x'.repeat(128) })
      ).status,
    ).toBe(201);
    expect(gw.callsTo(/POST/)).toHaveLength(1);
  });

  it('an idempotent replay of create makes ONE group and one Meta call', async () => {
    const x = await arrange('cr3');
    const send = () =>
      p.api
        .as(x.t.admin)
        .post(x.base)
        .set('Idempotency-Key', 'k-create-1')
        .send({ subject: 'Once' });
    const a = await send();
    const b = await send();
    expect(a.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(gw.callsTo(/POST/)).toHaveLength(1);
    const n = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM waba_groups WHERE org_id = $1`,
      [x.t.orgId],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it('when the answer was lost, the group_create webhook still makes the row, and a later create of the same id keeps the one row', async () => {
    const x = await arrange('cr4');
    await feed(x, 'group_lifecycle_update', {
      groups: [
        {
          group_id: 'GX',
          type: 'group_create',
          subject: 'From phone',
          invite_link: 'https://chat.whatsapp.com/p',
        },
      ],
    });
    const res = await p.api.as(x.t.admin).get(x.base);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ groupId: 'GX', subject: 'From phone' });
    expect(await outbox(x.t.orgId, 'whatsapp.group.created')).toHaveLength(1);
  });

  it('is newest first and paged by keyset', async () => {
    const x = await arrange('cr5');
    for (const s of ['one', 'two', 'three']) await createGroup(x, { subject: s });
    const page1 = await p.api.as(x.t.admin).get(`${x.base}?limit=2`);
    expect(page1.body.items.map((i: { subject: string }) => i.subject)).toEqual(['three', 'two']);
    expect(page1.body.page.hasMore).toBe(true);
    const page2 = await p.api
      .as(x.t.admin)
      .get(`${x.base}?limit=2&cursor=${encodeURIComponent(page1.body.page.nextCursor)}`);
    expect(page2.body.items.map((i: { subject: string }) => i.subject)).toEqual(['one']);
    expect(page2.body.stats.groups).toBe(3);
  });

  it("maps Meta's refusals to stable codes: limit, suspended, rate limit, a rejected parameter", async () => {
    const x = await arrange('cr6');
    const cases: Array<[number, number, string]> = [
      [131211, 422, 'WABA_GROUP_LIMIT_REACHED'],
      [131207, 422, 'WABA_GROUP_SUSPENDED'],
      [131208, 429, 'WABA_GROUP_RATE_LIMITED'],
      [131214, 422, 'WABA_GROUP_META_REJECTED'],
    ];
    for (const [code, status, expected] of cases) {
      gw.failWith(/POST/, code, 'developer words', 400);
      const res = await p.api.as(x.t.admin).post(x.base).send({ subject: 'A' });
      expect(res.status, String(code)).toBe(status);
      expect(res.body.code, String(code)).toBe(expected);
    }
    // Create is never retried, even on a transient failure.
    gw.failWith(/POST/, 1, 'down', 503);
    const down = await p.api.as(x.t.admin).post(x.base).send({ subject: 'A' });
    expect(down.status).toBe(503);
    expect(gw.callsTo(/POST/)).toHaveLength(5);
  });
});

describe('refresh, link reset, settings', () => {
  it('refresh pulls the state and the link from Meta and announces a change', async () => {
    const x = await arrange('rf1');
    const g = await createGroup(x);
    const meta = gw.groups.get(g.groupId)!;
    meta.participants = ['911', '922', '933'];
    meta.inviteLink = 'https://chat.whatsapp.com/fresh';
    meta.suspended = true;
    const res = await p.api.as(x.t.admin).post(`${x.base}/${g.id}/refresh`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      participantCount: 3,
      suspended: true,
      inviteLink: 'https://chat.whatsapp.com/fresh',
    });
    expect(
      gw.calls.find((c) => c.method === 'GET' && c.path === `/${g.groupId}`)!.query.fields,
    ).toContain('total_participant_count');
    expect(await outbox(x.t.orgId, 'whatsapp.group.suspended')).toHaveLength(1);
  });

  it('refresh keeps the old link when the link call fails', async () => {
    const x = await arrange('rf2');
    const g = await createGroup(x);
    gw.groups.get(g.groupId)!.inviteLink = 'https://chat.whatsapp.com/one';
    await p.api.as(x.t.admin).post(`${x.base}/${g.id}/refresh`);
    gw.failWith(/GET \/.*\/invite_link/, 1, 'x', 500, 3);
    const res = await p.api.as(x.t.admin).post(`${x.base}/${g.id}/refresh`);
    expect(res.status).toBe(200);
    expect(res.body.inviteLink).toBe('https://chat.whatsapp.com/one');
  });

  it('reset stores the new link, audits WITHOUT the link, and retries once on a transient failure', async () => {
    const x = await arrange('rs1');
    const g = await createGroup(x);
    gw.failWith(/POST \/.*\/invite_link/, 1, 'blip', 503);
    const res = await p.api.as(x.t.admin).post(`${x.base}/${g.id}/invite-link/reset`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.inviteLink).toMatch(/^https:\/\/chat\.whatsapp\.com\//);
    expect(gw.callsTo(/POST .*invite_link/)).toHaveLength(2);
    const log = await audits(x.t.orgId);
    const reset = log.find((l) => JSON.stringify(l.delta).includes('link_reset'));
    expect(reset).toBeDefined();
    expect(JSON.stringify(log)).not.toContain('chat.whatsapp.com');
    expect(JSON.stringify(await outbox(x.t.orgId, 'whatsapp.group.updated'))).not.toContain(
      'chat.whatsapp.com',
    );
  });

  it('settings answer 202, change nothing locally, and the webhook lands each field on its own (partial success)', async () => {
    const x = await arrange('st1');
    const g = await createGroup(x, { subject: 'Old', description: 'Old text' });
    const res = await p.api
      .as(x.t.admin)
      .patch(`${x.base}/${g.id}`)
      .send({ subject: 'New name', description: 'New text' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
    expect(gw.callsTo(/POST \/[^/]+$/).at(-1)!.body).toEqual({
      messaging_product: 'whatsapp',
      subject: 'New name',
      description: 'New text',
    });
    expect(await rowOf(x.t.orgId, g.id)).toMatchObject({ subject: 'Old', description: 'Old text' });

    // Meta confirms the subject but the description fails.
    await feed(x, 'group_settings_update', {
      groups: [
        {
          group_id: g.groupId,
          type: 'group_settings_update',
          group_subject: { text: 'New name', update_successful: true },
          group_description: { text: 'New text', update_successful: false },
        },
      ],
    });
    expect(await rowOf(x.t.orgId, g.id)).toMatchObject({
      subject: 'New name',
      description: 'Old text',
    });
    const updated = await outbox(x.t.orgId, 'whatsapp.group.updated');
    expect(updated.at(-1)).toMatchObject({ subject: 'New name', changed: ['subject'] });
    expect(
      (await audits(x.t.orgId)).some((a) => JSON.stringify(a.delta).includes('waba.group.update')),
    ).toBe(true);
  });

  it('settings need at least one field', async () => {
    const x = await arrange('st2');
    const g = await createGroup(x);
    expect((await p.api.as(x.t.admin).patch(`${x.base}/${g.id}`).send({})).status).toBe(422);
  });

  it('a rename retitles the group thread in the inbox', async () => {
    const x = await arrange('st3');
    const g = await createGroup(x, { subject: 'Neighbours' });
    await feed(x, 'group_lifecycle_update', {
      groups: [{ group_id: g.groupId, type: 'group_create', subject: 'Neighbours' }],
    });
    await feed(x, 'messages', {
      contacts: [{ profile: { name: 'Asha' }, wa_id: '919800000077' }],
      messages: [
        {
          from: '919800000077',
          id: `wamid.t.${seq}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'text',
          group_id: g.groupId,
          text: { body: 'hi' },
        },
      ],
    });
    const thread = async () =>
      (
        await p.h.owner.query(
          `SELECT title FROM conversations WHERE org_id = $1 AND peer_key = $2`,
          [x.t.orgId, `g:${g.groupId}`],
        )
      ).rows[0] as { title: string } | undefined;
    await until('the thread', thread);
    expect((await thread())!.title).toBe('Neighbours');

    await feed(x, 'group_settings_update', {
      groups: [
        {
          group_id: g.groupId,
          type: 'group_settings_update',
          group_subject: { text: 'Neighbours 2', update_successful: true },
        },
      ],
    });
    const { WabaGroupRetitleConsumer } =
      await import('../../../src/modules/chat-conversations/waba-group-retitle.consumer');
    const consumer = p.h.app.get(WabaGroupRetitleConsumer, { strict: false });
    const events = await p.h.owner.query(
      `SELECT id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
        WHERE org_id = $1 AND event_type = 'whatsapp.group.updated' ORDER BY id DESC LIMIT 1`,
      [x.t.orgId],
    );
    const e = events.rows[0];
    await consumer.handle({
      id: String(e.id),
      orgId: x.t.orgId,
      aggregateModule: e.aggregate_module,
      aggregateId: String(e.aggregate_id),
      eventType: e.event_type,
      payload: e.payload,
    });
    expect((await thread())!.title).toBe('Neighbours 2');
  });
});

describe('join requests, members, removal, delete', () => {
  it('approve and reject clear the handled ids; the numbers go only to a holder of waba.groups.manage', async () => {
    const x = await arrange('jr1');
    const g = await createGroup(x, { subject: 'Gate', joinApprovalMode: 'approval_required' });
    gw.groups.get(g.groupId)!.joinRequests = ['j1', 'j2', 'j3'];
    for (const [id, wa] of [
      ['j1', '91990000911'],
      ['j2', '91990000922'],
      ['j3', '91990000933'],
    ] as const) {
      await feed(x, 'group_participants_update', {
        groups: [
          {
            group_id: g.groupId,
            type: 'group_join_request_created',
            join_request_id: id,
            wa_id: wa,
            timestamp: 1,
          },
        ],
      });
    }
    const admin = await p.api.as(x.t.admin).get(x.base);
    expect(
      admin.body.items[0].pendingJoinRequests.map((r: { waId: string }) => r.waId).sort(),
    ).toEqual(['91990000911', '91990000922', '91990000933']);
    expect(admin.body.stats.joinRequests).toBe(3);
    expect(await outbox(x.t.orgId, 'whatsapp.group.join_request')).toHaveLength(3);

    const reader = await p.api.member(x.t, 'reader', [['waba.groups.read']]);
    const seen = await p.api.as(reader.token).get(x.base);
    expect(seen.status).toBe(200);
    expect(seen.body.items[0].pendingJoinRequestCount).toBe(3);
    expect(seen.body.items[0].pendingJoinRequests).toEqual([]);
    expect(JSON.stringify(seen.body)).not.toContain('91990000911');

    const approve = await p.api
      .as(x.t.admin)
      .post(`${x.base}/${g.id}/join-requests`)
      .send({ action: 'approve', ids: ['j1'] });
    expect(approve.body).toEqual({ ok: true, handled: 1 });
    const reject = await p.api
      .as(x.t.admin)
      .post(`${x.base}/${g.id}/join-requests`)
      .send({ action: 'reject', ids: ['j2'] });
    expect(reject.status).toBe(200);
    expect(gw.callsTo(/POST .*join_requests/)[0]!.body).toEqual({
      messaging_product: 'whatsapp',
      join_requests: ['j1'],
    });
    expect(gw.callsTo(/DELETE .*join_requests/)[0]!.body).toEqual({
      messaging_product: 'whatsapp',
      join_requests: ['j2'],
    });
    const left = await p.api.as(x.t.admin).get(x.base);
    expect(left.body.items[0].pendingJoinRequests.map((r: { id: string }) => r.id)).toEqual(['j3']);
    const handled = (await outbox(x.t.orgId, 'whatsapp.group.join_request')).filter(
      (e) => e.handled,
    );
    expect(handled.map((e) => e.handled)).toEqual(['approved', 'rejected']);
    expect(JSON.stringify(handled)).not.toContain('91990000911');
    const a = await audits(x.t.orgId);
    expect(JSON.stringify(a)).not.toContain('91990000911');
  });

  it("Meta's wording reaches the person when a request is gone (131213), and an empty list is refused", async () => {
    const x = await arrange('jr2');
    const g = await createGroup(x);
    gw.failWith(/POST .*join_requests/, 131213, 'dev', 400);
    const res = await p.api
      .as(x.t.admin)
      .post(`${x.base}/${g.id}/join-requests`)
      .send({ action: 'approve', ids: ['zz'] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WABA_GROUP_META_REJECTED');
    expect(res.body.message ?? res.body.detail).toMatch(/no longer exists/);
    expect(
      (
        await p.api
          .as(x.t.admin)
          .post(`${x.base}/${g.id}/join-requests`)
          .send({ action: 'approve', ids: [] })
      ).status,
    ).toBe(422);
  });

  it('lists the members on demand (never stored) and removes up to 8, not 9, without retrying', async () => {
    const x = await arrange('mb1');
    const g = await createGroup(x);
    gw.groups.get(g.groupId)!.participants = Array.from({ length: 10 }, (_, i) => `9100${i}`);
    const members = await p.api.as(x.t.admin).get(`${x.base}/${g.id}/participants`);
    expect(members.body.total).toBe(10);
    expect(members.body.members[0]).toEqual({ waId: '91000' });

    const tooMany = await p.api
      .as(x.t.admin)
      .delete(`${x.base}/${g.id}/participants`)
      .send({ participants: Array.from({ length: 9 }, (_, i) => `9100${i}`) });
    expect(tooMany.status).toBe(422);
    const ok = await p.api
      .as(x.t.admin)
      .delete(`${x.base}/${g.id}/participants`)
      .send({ participants: Array.from({ length: 8 }, (_, i) => `9100${i}`) });
    expect(ok.body).toEqual({ ok: true, removed: 8 });
    expect(gw.groups.get(g.groupId)!.participants).toHaveLength(2);
    const a = await audits(x.t.orgId);
    expect(JSON.stringify(a)).not.toContain('9100');
    // Not retried on a transient failure.
    gw.failWith(/DELETE .*participants/, 1, 'blip', 503);
    const calls = gw.callsTo(/DELETE .*participants/).length;
    const failed = await p.api
      .as(x.t.admin)
      .delete(`${x.base}/${g.id}/participants`)
      .send({ participants: ['91008'] });
    expect(failed.status).toBe(503);
    expect(gw.callsTo(/DELETE .*participants/).length).toBe(calls + 1);
  });

  it('delete removes the group on Meta and the row, audits and announces it, and the webhook repeat is harmless', async () => {
    const x = await arrange('dl1');
    const g = await createGroup(x);
    const res = await p.api.as(x.t.admin).delete(`${x.base}/${g.id}`);
    expect(res.status).toBe(204);
    expect(gw.groups.has(g.groupId)).toBe(false);
    expect(await rowOf(x.t.orgId, g.id)).toBeUndefined();
    expect(await outbox(x.t.orgId, 'whatsapp.group.deleted')).toHaveLength(1);
    expect((await audits(x.t.orgId)).at(-1)!.action).toBe('delete');
    await feed(x, 'group_lifecycle_update', {
      groups: [{ group_id: g.groupId, type: 'group_delete' }],
    });
    expect(await outbox(x.t.orgId, 'whatsapp.group.deleted')).toHaveLength(1);
    expect((await p.api.as(x.t.admin).delete(`${x.base}/${g.id}`)).status).toBe(404);
  });

  it('delete retried after a lost answer finds the group gone and still finishes', async () => {
    const x = await arrange('dl2');
    const g = await createGroup(x);
    // First attempt: Meta deletes but the answer is lost (503); the retry meets 131041.
    gw.failWith(/DELETE \/[^/]+$/, 1, 'lost', 503);
    gw.failWith(/DELETE \/[^/]+$/, 131041, 'gone', 400);
    gw.failWith(/DELETE \/[^/]+$/, 131041, 'gone', 400, 0);
    const res = await p.api.as(x.t.admin).delete(`${x.base}/${g.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    expect(await rowOf(x.t.orgId, g.id)).toBeUndefined();
  });

  it('a Meta 131041 on a first delete attempt is an error, not a silent success', async () => {
    const x = await arrange('dl3');
    const g = await createGroup(x);
    gw.failWith(/DELETE \/[^/]+$/, 131041, 'gone', 400);
    const res = await p.api.as(x.t.admin).delete(`${x.base}/${g.id}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('WABA_GROUP_NOT_FOUND');
    expect(await rowOf(x.t.orgId, g.id)).toBeDefined();
  });
});

describe('tenancy, permissions and the rate budget', () => {
  it('another workspace sees "not found" for a number and for a group, never the data', async () => {
    const a = await arrange('tn1');
    const b = await arrange('tn2');
    const g = await createGroup(a);
    expect((await p.api.as(b.t.admin).get(a.base)).status).toBe(404);
    const crossGroup = await p.api.as(b.t.admin).post(`${b.base}/${g.id}/refresh`);
    expect(crossGroup.status).toBe(404);
    expect(crossGroup.body.code).toBe('WABA_GROUP_NOT_FOUND');
    // A group of the same workspace but another number is not found either.
    expect(gw.calls.filter((c) => c.path === `/${g.groupId}`)).toHaveLength(0);
  });

  it('read, create, manage and delete are separate keys', async () => {
    const x = await arrange('pm1');
    const g = await createGroup(x);
    const reader = await p.api.member(x.t, 'ro', [['waba.groups.read']]);
    const creator = await p.api.member(x.t, 'cr', [['waba.groups.read'], ['waba.groups.create']]);
    const asReader = p.api.as(reader.token);
    expect((await asReader.get(x.base)).status).toBe(200);
    expect((await asReader.post(`${x.base}/${g.id}/refresh`)).status).toBe(200);
    expect((await asReader.post(x.base).send({ subject: 'x' })).status).toBe(403);
    expect((await asReader.post(`${x.base}/${g.id}/invite-link/reset`)).status).toBe(403);
    expect((await asReader.get(`${x.base}/${g.id}/participants`)).status).toBe(403);
    expect((await asReader.delete(`${x.base}/${g.id}`)).status).toBe(403);
    expect((await p.api.as(creator.token).post(x.base).send({ subject: 'Mine' })).status).toBe(201);
    expect((await p.api.as(creator.token).delete(`${x.base}/${g.id}`)).status).toBe(403);
    const nobody = await p.api.member(x.t, 'none', [['inbox.conversation.read']]);
    expect((await p.api.as(nobody.token).get(x.base)).status).toBe(403);
  });

  it("a number's changes are limited per minute (WABA_GROUP_RATE_LIMITED, 429) without calling Meta again", async () => {
    const x = await arrange('rl1');
    const g = await createGroup(x);
    let last = 0;
    let code = '';
    for (let i = 0; i < 32; i++) {
      const res = await p.api
        .as(x.t.admin)
        .patch(`${x.base}/${g.id}`)
        .send({ description: `d${i}` });
      last = res.status;
      code = res.body.code ?? '';
      if (last === 429) break;
    }
    expect(last).toBe(429);
    expect(code).toBe('WABA_GROUP_RATE_LIMITED');
    expect(gw.callsTo(/POST \/[^/]+$/).length).toBeLessThanOrEqual(31);
  });
});

describe('removing a number (decision D6: the rows cascade, with a warning)', () => {
  it('counts the group records the removal deletes, even when the plan lapsed, and the rows really go with the number', async () => {
    const x = await arrange('rm1');
    await createGroup(x, { subject: 'One' });
    await createGroup(x, { subject: 'Two' });
    const count = await p.api.as(x.t.admin).get(`/v2/waba/numbers/${x.id}/group-count`);
    expect(count.body).toEqual({ count: 2 });
    await p.h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      x.t.orgId,
      JSON.stringify({ features: { waba_groups: false } }),
    ]);
    expect((await p.api.as(x.t.admin).get(`/v2/waba/numbers/${x.id}/group-count`)).body).toEqual({
      count: 2,
    });
    const reader = await p.api.member(x.t, 'gc', [['waba.groups.read']]);
    expect((await p.api.as(reader.token).get(`/v2/waba/numbers/${x.id}/group-count`)).status).toBe(
      403,
    );
    expect((await p.api.as(x.t.admin).delete(`/v2/waba/numbers/${x.id}`)).status).toBeLessThan(300);
    const left = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM waba_groups WHERE org_id = $1`,
      [x.t.orgId],
    );
    expect(left.rows[0].n).toBe(0);
  });
});
