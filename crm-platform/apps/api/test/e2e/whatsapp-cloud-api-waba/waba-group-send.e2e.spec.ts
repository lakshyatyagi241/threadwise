import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MESSAGE_DELIVERY_EVENT } from '@crm/contracts';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { wabaGroupsEligibleKey } from '../../../src/infra/providers/whatsapp/group-peer';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import { WabaChannelLinkService } from '../../../src/modules/chat-conversations/waba-channel-link.service';
import { WalletLedgerService } from '../../../src/modules/wallet-message-billing';
import { graphFixture } from '../../fixtures/whatsapp';
import { startPipeline, until, type Pipeline } from '../chat-conversations/pipeline-support';

/**
 * Sending to a Meta Cloud API group from the inbox, phase 3 of docs/specs/waba-groups-management.md, end to end: the real API, a real
 * Postgres and Redis, the real send worker and the real WABA ingest, with only Meta's Graph faked at the HTTP edge. NOTHING here ran
 * against real Meta (there is no Official Business Account to test with, BL-030): the request and status shapes are the spec's
 * "from the reference" facts. Covered: the plan gate (PLAN_FEATURE_LOCKED), the suspended refusal (D10), the wallet check against the
 * group size (D8, WALLET_EMPTY), the composer state on the conversation, the per-member status roll-up, the per-member billing events,
 * the permission, and workspace isolation.
 */
let p: Pipeline;
let calls: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];
let ingest: { process: (changes: unknown[]) => Promise<unknown> };
let split: (payload: unknown) => unknown[];
let seq = 0;

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
  const { WabaIngestService } =
    await import('../../../src/modules/whatsapp-cloud-api-waba/waba-ingest.service');
  const { splitWebhook } = await import('../../../src/modules/whatsapp-cloud-api-waba/waba-rules');
  ingest = p.h.app.get(WabaIngestService) as never;
  split = splitWebhook as never;
}, 900_000);

afterAll(async () => {
  await p?.stop();
});

const GROUP = 'g:Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2';
const GROUP_ID = GROUP.slice(2);

async function arrange(label: string, o: { members?: number; wallet?: 'reseller' | 'plan' } = {}) {
  const t = await p.api.signup(label);
  const n = seq++;
  const phoneNumberId = `7300${n}00`;
  const wabaId = `77${phoneNumberId}`;
  const row = await p.h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, is_primary, phone_number, display_label, credentials_json, meta_json, connected_at)
     VALUES ($1, 'waba', 'connected', true, $2, 'Support line', $3, $4::jsonb, now()) RETURNING id`,
    [
      t.orgId,
      `+9191155${String(10000 + n)}`,
      p.h.app.get(CryptoService).encrypt(JSON.stringify({ access_token: `EAAG-token-${n}` })),
      JSON.stringify({ provider: 'meta', waba_id: wabaId, phone_number_id: phoneNumberId }),
    ],
  );
  const configId = Number(row.rows[0].id);
  const channel = await p.h.app
    .get(WabaChannelLinkService, { strict: false })
    .ensure(t.orgId, configId, { create: true });
  if (!channel) throw new Error('no inbox channel was made for the number');
  const thread = (
    await p.h.owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title, last_inbound_at, window_expires_at)
       VALUES ($1,$2,$3,'Neighbours', now(), now() + interval '1 day') RETURNING id, uuid`,
      [t.orgId, channel.id, GROUP],
    )
  ).rows[0] as { id: number | string; uuid: string };
  if (o.members !== undefined) {
    await p.h.owner.query(
      `INSERT INTO waba_groups (org_id, provider_config_id, group_id, subject, participant_count, suspended)
       VALUES ($1,$2,$3,'Neighbours',$4,false)`,
      [t.orgId, configId, GROUP_ID, o.members],
    );
  }
  // 'reseller': billed from the wallet per message (so an empty wallet refuses); the default is the plan's own allowance.
  if (o.wallet === 'reseller') {
    await p.h.owner.query(
      `INSERT INTO workspace_settings (org_id, bill_to_platform_credit) VALUES ($1, true)
       ON CONFLICT (org_id) DO UPDATE SET bill_to_platform_credit = true`,
      [t.orgId],
    );
  }
  return { t, channel, thread, phoneNumberId, wabaId, configId };
}
type Arranged = Awaited<ReturnType<typeof arrange>>;

const setPlanGroups = (orgId: number, on: boolean) =>
  p.h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
    orgId,
    JSON.stringify({ features: { waba_groups: on } }),
  ]);
/** Puts money in the wallet through the ledger, the way a paid top-up does (hundredths). */
const fund = (orgId: number, minor: number) =>
  p.h.app.get(DatabaseService).txAs({ orgId, userId: null }, (tx) =>
    p.h.app.get(WalletLedgerService, { strict: false }).post(tx, {
      orgId,
      unit: 'USD',
      type: 'topup',
      direction: 'in',
      amountMinor: minor,
      idempotencyKey: `fund:${orgId}:${randomUUID()}`,
      source: 'topup.conversion',
      description: 'Wallet top-up',
    }),
  );

const reply = (token: string, uuid: string, body: Record<string, unknown>) =>
  p.api.as(token).post(`/v2/inbox/conversations/${uuid}/messages`).send(body);
const text = (body = 'Hello everyone') => ({ kind: 'text', body, clientMessageId: randomUUID() });
const detail = (token: string, uuid: string) =>
  p.api.as(token).get(`/v2/inbox/conversations/${uuid}`);
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

const feedStatuses = (x: Arranged, statuses: Array<Record<string, unknown>>) =>
  ingest.process(
    split({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: x.wabaId,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: x.phoneNumberId },
                statuses,
              },
            },
          ],
        },
      ],
    }),
  );

describe('the plan gate on a group send', () => {
  it('a workspace without waba_groups is refused 422 PLAN_FEATURE_LOCKED: nothing stored, queued or sent; with it, the same send goes', async () => {
    const x = await arrange('gp1', { members: 4 });
    await setPlanGroups(x.t.orgId, false);
    calls = [];
    const res = await reply(x.t.admin, x.thread.uuid, text());
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    expect(await count(x.thread.id)).toBe(0);
    await pause(600);
    expect(calls).toHaveLength(0);

    await setPlanGroups(x.t.orgId, true);
    const ok = await reply(x.t.admin, x.thread.uuid, text());
    expect(ok.status, JSON.stringify(ok.body)).toBe(202);
    await until('the send to reach Meta', () => (sends().length > 0 ? sends() : undefined));
  }, 90_000);

  it('a phone thread of a workspace without waba_groups still sends (the gate is only for groups)', async () => {
    const x = await arrange('gp2');
    await setPlanGroups(x.t.orgId, false);
    const phone = (
      await p.h.owner.query(
        `INSERT INTO conversations (org_id, channel_id, peer_key, title, last_inbound_at, window_expires_at)
         VALUES ($1,$2,'919900000050','Asha', now(), now() + interval '1 day') RETURNING uuid`,
        [x.t.orgId, x.channel.id],
      )
    ).rows[0] as { uuid: string };
    const res = await reply(x.t.admin, phone.uuid, text('Your order shipped'));
    expect(res.status, JSON.stringify(res.body)).toBe(202);
  }, 60_000);
});

describe('the suspended refusal (D10) and the composer state', () => {
  it('detail carries cloudGroup: the member count, canSend and an estimate for an active group', async () => {
    const x = await arrange('gc1', { members: 8, wallet: 'reseller' });
    const res = await detail(x.t.admin, x.thread.uuid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.cloudGroup).toMatchObject({
      groupId: GROUP_ID,
      subject: 'Neighbours',
      memberCount: 8,
      suspended: false,
      block: null,
      canSend: true,
    });
    // The wallet is empty and the workspace is billed from it: the composer warns, and does not switch off.
    expect(res.body.cloudGroup.walletShort).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('chat.whatsapp.com');
  }, 60_000);

  it('a suspended group is blocked "suspended" with no estimate; the same send is refused 422 WABA_GROUP_SUSPENDED', async () => {
    const x = await arrange('gc2', { members: 8 });
    await p.h.owner.query(`UPDATE waba_groups SET suspended = true WHERE org_id = $1`, [x.t.orgId]);
    const d = await detail(x.t.admin, x.thread.uuid);
    expect(d.body.cloudGroup).toMatchObject({
      suspended: true,
      block: 'suspended',
      canSend: false,
      estimate: null,
    });
    calls = [];
    const res = await reply(x.t.admin, x.thread.uuid, text());
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WABA_GROUP_SUSPENDED');
    expect(await count(x.thread.id)).toBe(0);
    await pause(600);
    expect(calls).toHaveLength(0);
  }, 60_000);

  it('a plan without waba_groups shows block "plan"; a number last probed as not eligible shows "ineligible"', async () => {
    const x = await arrange('gc3', { members: 3 });
    await setPlanGroups(x.t.orgId, false);
    expect((await detail(x.t.admin, x.thread.uuid)).body.cloudGroup).toMatchObject({
      block: 'plan',
      canSend: false,
    });
    await setPlanGroups(x.t.orgId, true);
    const redis = p.h.app.get(REDIS_CLIENT);
    await redis.set(wabaGroupsEligibleKey(x.t.orgId, x.configId), '0', 'EX', 60);
    expect((await detail(x.t.admin, x.thread.uuid)).body.cloudGroup).toMatchObject({
      block: 'ineligible',
      canSend: false,
    });
    await redis.del(wabaGroupsEligibleKey(x.t.orgId, x.configId));
    expect((await detail(x.t.admin, x.thread.uuid)).body.cloudGroup).toMatchObject({
      block: null,
      canSend: true,
    });
  }, 60_000);

  it('a phone thread has no cloudGroup', async () => {
    const x = await arrange('gc4');
    const phone = (
      await p.h.owner.query(
        `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,'919900000051','Asha') RETURNING uuid`,
        [x.t.orgId, x.channel.id],
      )
    ).rows[0] as { uuid: string };
    expect((await detail(x.t.admin, phone.uuid)).body.cloudGroup).toBeUndefined();
  }, 60_000);
});

describe('the wallet check against the group size (D8)', () => {
  it('refuses 422 WALLET_EMPTY on an empty wallet before anything is stored, queued or sent', async () => {
    const x = await arrange('gw1', { members: 8, wallet: 'reseller' });
    calls = [];
    const res = await reply(x.t.admin, x.thread.uuid, text());
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('WALLET_EMPTY');
    expect(await count(x.thread.id)).toBe(0);
    await pause(600);
    expect(calls).toHaveLength(0);
  }, 60_000);

  it('goes once the wallet covers the group', async () => {
    const x = await arrange('gw2', { members: 8, wallet: 'reseller' });
    await fund(x.t.orgId, 100_000);
    calls = [];
    const res = await reply(x.t.admin, x.thread.uuid, text());
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    await until('the send to reach Meta', () => (sends().length > 0 ? sends() : undefined));
  }, 60_000);
});

describe('what a sent group message shows: the member count, the roll-up, the billing events', () => {
  it('stamps the group size on the message, rolls per-member statuses up, and reports each billable member to the wallet once', async () => {
    const x = await arrange('gd1', { members: 8 });
    calls = [];
    const res = await reply(x.t.admin, x.thread.uuid, text('Meeting at 6'));
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const sent = await until('the message to be sent', async () => {
      const r = (
        await p.h.owner.query(
          `SELECT status, provider_message_id, meta FROM messages WHERE uuid = $1`,
          [res.body.id],
        )
      ).rows[0];
      return r && r.status !== 'queued' && r.provider_message_id ? r : undefined;
    });
    expect(sent.meta.group_members).toBe(8);
    const wamid = sent.provider_message_id as string;

    const status = (member: string, st: string, pricing: Record<string, unknown>) => ({
      id: wamid,
      status: st,
      timestamp: String(Math.floor(Date.now() / 1000)),
      recipient_type: 'group',
      recipient_participant_id: member,
      conversation: { origin: { type: 'service' }, pricing },
    });
    await feedStatuses(x, [
      status('919900000001', 'delivered', { billable: true }),
      status('919900000002', 'read', { billable: true }),
      status('919900000003', 'delivered', { type: 'free_group_customer_service' }),
      status('919900000004', 'failed', { billable: true }),
      status('919900000001', 'sent', { billable: true }), // out of order: never moves a member backwards
      status('919900000001', 'delivered', { billable: true }), // a webhook retry
    ]);

    const wire = await p.api.as(x.t.admin).get(`/v2/inbox/conversations/${x.thread.uuid}/messages`);
    expect(wire.status).toBe(200);
    const mine = (wire.body.data as Array<Record<string, unknown>>).find(
      (m) => m.id === res.body.id,
    );
    expect(mine?.groupDelivery).toEqual({
      members: 8,
      deliveredTo: 3,
      readBy: 1,
      failed: 1,
      billable: 3,
      free: 1,
    });
    // Member numbers are personal data: the wire carries counts only.
    expect(JSON.stringify(mine)).not.toContain('9199000000');

    // Money: one report per billable member that delivered or read; none for the free member, the failed one or a retry.
    const reported = (await p.api.events(x.t.orgId, MESSAGE_DELIVERY_EVENT))
      .map((e) => String(e.providerMessageId))
      .sort();
    expect(reported).toEqual([`${wamid}:919900000001`, `${wamid}:919900000002`]);
  }, 90_000);
});

describe('who may send, and workspace isolation', () => {
  it('a member without inbox.conversation.reply cannot send to the group', async () => {
    const x = await arrange('gz1', { members: 4 });
    const reader = await p.api.member(x.t, 'reader', [['inbox.conversation.read']]);
    const res = await reply(reader.token, x.thread.uuid, text());
    expect(res.status).toBe(403);
    expect(await count(x.thread.id)).toBe(0);
  }, 60_000);

  it('another workspace cannot read or write the group thread, and its own suspended copy of the id changes nothing here', async () => {
    const a = await arrange('gz2', { members: 4 });
    const b = await arrange('gz3', { members: 4 });
    await p.h.owner.query(`UPDATE waba_groups SET suspended = true WHERE org_id = $1`, [b.t.orgId]);
    expect((await detail(b.t.admin, a.thread.uuid)).status).toBe(404);
    expect((await reply(b.t.admin, a.thread.uuid, text())).status).toBe(404);
    // A's group, with the same Meta id as B's suspended one, is untouched by B's row.
    const own = await reply(a.t.admin, a.thread.uuid, text());
    expect(own.status, JSON.stringify(own.body)).toBe(202);
  }, 90_000);
});
