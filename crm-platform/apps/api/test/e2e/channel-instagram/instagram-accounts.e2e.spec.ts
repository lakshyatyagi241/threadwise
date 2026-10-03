import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  INSTAGRAM_BRIDGE,
  type BridgeAccount,
  type BridgeResult,
  type InstagramBridgeFactory,
} from '../../../src/infra/providers/channel-instagram/instagram-bridge.port';
import { PlatformSettingsService } from '../../../src/modules/auth';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Linking Instagram accounts (TW-IG-001 to 006), against a real Postgres and a fake engine. */
let h: Harness;
let api: Api;
let settings: PlatformSettingsService;

const asked: Array<{ method: string; args: unknown[] }> = [];
let byWorkspace: BridgeAccount[] = [];
let byOwner: BridgeAccount[] = [];
let start: BridgeResult<{ url: string }> = {
  ok: true,
  data: { url: 'https://engine.test/login?t=1' },
};

const acct = (id: string, extra: Partial<BridgeAccount> = {}): BridgeAccount => ({
  id,
  username: `user${id}`,
  name: `Name ${id}`,
  avatar: `https://cdn.test/${id}.png`,
  connected: true,
  ...extra,
});

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  settings = h.app.get(PlatformSettingsService);
  const bridge = h.app.get<InstagramBridgeFactory>(INSTAGRAM_BRIDGE);
  bridge.with = () => ({
    accounts: (q) => {
      asked.push({ method: 'accounts', args: [q] });
      return Promise.resolve(q.ownerEmail !== undefined ? byOwner : byWorkspace);
    },
    conversations: () => Promise.resolve([]),
    messages: () => Promise.resolve([]),
    reply: () => Promise.resolve({ ok: true, data: { messageId: null } }),
    flows: () => Promise.resolve([]),
    runFlow: () => Promise.resolve({ ok: true, data: null }),
    connectStart: (workspace, returnUrl) => {
      asked.push({ method: 'connectStart', args: [workspace, returnUrl] });
      return Promise.resolve(start);
    },
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

async function engine(on: boolean): Promise<void> {
  await settings.mergeMember(
    'addons.engines',
    'instagram',
    { url: on ? 'https://engine.test' : '', brand: 'IgDesk', connected: on },
    null,
  );
  await settings.setSecret('addons.engine.instagram.secret', 's3cret', null);
}

beforeEach(async () => {
  asked.length = 0;
  byWorkspace = [];
  byOwner = [];
  start = { ok: true, data: { url: 'https://engine.test/login?t=1' } };
  await engine(true);
});

const rows = async (t: Tenant) =>
  (
    await h.owner.query(`SELECT * FROM workspace_ig_accounts WHERE org_id = $1 ORDER BY id`, [
      t.orgId,
    ])
  ).rows;

/** A thread on a channel of its own (`instagram`, or `whatsapp` standing for a Cloud API number), with one customer message. */
async function thread(t: Tenant, channel: string, key: string): Promise<number> {
  const ch = await h.owner.query(
    `INSERT INTO channels (org_id, kind, name, status) VALUES ($1, $2, 'T', 'connected') RETURNING id`,
    [t.orgId, channel === 'whatsapp' ? 'whatsapp_cloud' : channel],
  );
  const c = await h.owner.query(
    `INSERT INTO conversations (org_id, channel_id, peer_key, title, last_message_at)
     VALUES ($1, $2, $3, 'T', now()) RETURNING id`,
    [t.orgId, ch.rows[0].id, key],
  );
  const id = Number(c.rows[0].id);
  await h.owner.query(
    `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, body, status)
     VALUES ($1, $2, 1, 'in', 'customer', 'hi', 'received')`,
    [t.orgId, id],
  );
  return id;
}

const instagramThreads = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT count(*)::int AS n FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
       WHERE c.org_id = $1 AND ch.kind = 'instagram'`,
      [orgId],
    )
  ).rows[0].n as number;

const link = (t: Tenant, body: Record<string, unknown>) =>
  api.http().post('/v2/instagram/accounts').set(bearer(t.admin)).send(body);

describe('the hub (TW-IG-001)', () => {
  it('lists the linked accounts and says whether the engine is connected', async () => {
    const t = await api.signup('igl');
    byWorkspace = [acct('1')];
    expect((await link(t, { instaflowAccountId: '1' })).status).toBe(200);

    const on = await api.http().get('/v2/instagram/accounts').set(bearer(t.admin));
    expect(on.status).toBe(200);
    expect(on.body.data).toHaveLength(1);
    expect(on.body.data[0]).toMatchObject({
      instaflowAccountId: '1',
      username: 'user1',
      status: 'connected',
    });
    expect(on.body.bridge).toEqual({
      connected: true,
      brand: 'IgDesk',
      manageUrl: 'https://engine.test/instagram',
    });

    await engine(false);
    const off = await api.http().get('/v2/instagram/accounts').set(bearer(t.admin));
    expect(off.body.bridge).toEqual({ connected: false, brand: 'IgDesk', manageUrl: null });
  });

  it('never shows another organization’s accounts', async () => {
    const a = await api.signup('iga');
    const b = await api.signup('igb');
    byWorkspace = [acct('1')];
    await link(a, { instaflowAccountId: '1' });
    const res = await api.http().get('/v2/instagram/accounts').set(bearer(b.admin));
    expect(res.body.data).toEqual([]);
  });
});

describe('the picker (TW-IG-003)', () => {
  it('offers the person’s own engine accounts that are not linked yet, matched by email', async () => {
    const t = await api.signup('igp');
    byOwner = [acct('1'), acct('2')];
    byWorkspace = [acct('2')];
    await link(t, { instaflowAccountId: '2' });

    const res = await api.http().get('/v2/instagram/accounts/available').set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.map((a: { id: string }) => a.id)).toEqual(['1']);
    const email = (await h.owner.query(`SELECT email FROM users WHERE id = $1`, [t.adminUserId]))
      .rows[0].email;
    expect(asked.some((c) => (c.args[0] as { ownerEmail?: string }).ownerEmail === email)).toBe(
      true,
    );
  });

  it('is empty when the engine is not connected', async () => {
    const t = await api.signup('igq');
    byOwner = [acct('1')];
    await engine(false);
    const res = await api.http().get('/v2/instagram/accounts/available').set(bearer(t.admin));
    expect(res.body.data).toEqual([]);
  });
});

describe('link and refresh (TW-IG-004)', () => {
  it('links an account the engine lists to the workspace, and links again on the same row', async () => {
    const t = await api.signup('igk');
    byWorkspace = [acct('1')];
    const first = await link(t, { instaflowAccountId: '1', followers: 120 });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    byWorkspace = [acct('1', { name: 'Renamed', connected: false })];
    const second = await link(t, { instaflowAccountId: '1' });
    expect(second.body.id).toBe(first.body.id);
    expect(second.body).toMatchObject({ name: 'Renamed', status: 'disconnected', followers: 120 });
    expect(await rows(t)).toHaveLength(1);
  });

  it('links an account only the person owns (the picker)', async () => {
    const t = await api.signup('igo');
    byOwner = [acct('7')];
    const res = await link(t, { instaflowAccountId: '7' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('refuses an account the engine does not list to this workspace or person, even with a username', async () => {
    const t = await api.signup('igr');
    byWorkspace = [acct('1')];
    byOwner = [acct('2')];
    const res = await link(t, { instaflowAccountId: '99', username: 'someone_else' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('IG_ACCOUNT_NOT_FOUND');
    expect(await rows(t)).toHaveLength(0);
  });

  it('is refused while the engine is not connected', async () => {
    const t = await api.signup('ign');
    await engine(false);
    const res = await link(t, { instaflowAccountId: '1' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IG_NOT_CONNECTED');
  });

  it('needs the manage permission: a member who may only view cannot link', async () => {
    const t = await api.signup('igm');
    const viewer = await api.member(t, 'viewer', [['ig.accounts.read']]);
    byWorkspace = [acct('1')];
    const res = await api
      .http()
      .post('/v2/instagram/accounts')
      .set(bearer(viewer.token))
      .send({ instaflowAccountId: '1' });
    expect(res.status).toBe(403);
  });
});

describe('connect new (TW-IG-005)', () => {
  it('asks the engine for a ticket with this workspace and the hub as the return address', async () => {
    const t = await api.signup('igc');
    const res = await api.http().post('/v2/instagram/connect/start').set(bearer(t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.url).toBe('https://engine.test/login?t=1');
    const call = asked.find((c) => c.method === 'connectStart')!;
    expect(call.args[0]).toBe(t.orgId);
    expect(String(call.args[1])).toMatch(/\/instagram$/);
  });

  it('turns the engine’s refusal into a 502 with its words, and an off engine into a 422', async () => {
    const t = await api.signup('igd');
    start = { ok: false, error: 'Ticket service down', status: 500 };
    const bad = await api.http().post('/v2/instagram/connect/start').set(bearer(t.admin));
    expect(bad.status).toBe(502);
    expect(bad.body.code).toBe('IG_CONNECT_FAILED');
    expect(JSON.stringify(bad.body)).toContain('Ticket service down');

    await engine(false);
    const off = await api.http().post('/v2/instagram/connect/start').set(bearer(t.admin));
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('IG_NOT_CONNECTED');
  });
});

describe('unlink (TW-IG-006)', () => {
  it('keeps every thread while another account remains, and deletes them with the last one', async () => {
    const t = await api.signup('igu');
    const other = await api.signup('igv');
    byWorkspace = [acct('1'), acct('2')];
    const one = await link(t, { instaflowAccountId: '1' });
    const two = await link(t, { instaflowAccountId: '2' });
    await thread(t, 'instagram', 'ig:a');
    await thread(t, 'whatsapp', 'wa:1');
    await thread(other, 'instagram', 'ig:z');

    const first = await api
      .http()
      .delete(`/v2/instagram/accounts/${one.body.id}`)
      .set(bearer(t.admin));
    expect(first.status).toBe(200);
    expect(first.body.purgedThreads).toBe(0);
    expect(await instagramThreads(t.orgId)).toBe(1);

    const last = await api
      .http()
      .delete(`/v2/instagram/accounts/${two.body.id}`)
      .set(bearer(t.admin));
    expect(last.body.purgedThreads).toBe(1);
    const mine = await h.owner.query(
      `SELECT ch.kind, (SELECT count(*)::int FROM messages m WHERE m.org_id = c.org_id AND m.conversation_id = c.id) AS msgs
       FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id WHERE c.org_id = $1`,
      [t.orgId],
    );
    expect(mine.rows).toEqual([{ kind: 'whatsapp_cloud', msgs: 1 }]);
    expect(await instagramThreads(other.orgId)).toBe(1);
    // The unlinked accounts' inbox channels are kept, switched off.
    const channels = await h.owner.query(
      `SELECT status FROM channels WHERE org_id = $1 AND kind = 'instagram' AND external_id IN ('1', '2')`,
      [t.orgId],
    );
    expect(channels.rows.map((r) => r.status)).toEqual(['disconnected', 'disconnected']);
    expect(await rows(t)).toHaveLength(0);
  });

  it('answers 404 for an account of another organization', async () => {
    const a = await api.signup('igw');
    const b = await api.signup('igx');
    byWorkspace = [acct('1')];
    const made = await link(a, { instaflowAccountId: '1' });
    const res = await api
      .http()
      .delete(`/v2/instagram/accounts/${made.body.id}`)
      .set(bearer(b.admin));
    expect(res.status).toBe(404);
    expect(await rows(a)).toHaveLength(1);
  });
});
