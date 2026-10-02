import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  INSTAGRAM_BRIDGE,
  type BridgeAccount,
  type BridgeConversation,
  type BridgeMessage,
  type InstagramBridgeFactory,
} from '../../../src/infra/providers/channel-instagram/instagram-bridge.port';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { PullService } from '../../../src/modules/channel-instagram/pull.service';
import {
  INSTAGRAM_AUTOMATION,
  type AutomationContext,
  type InstagramAutomation,
} from '../../../src/modules/channel-instagram/_shims/tokens';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** The Instagram push and pull into the inbox (TW-IG-007 to 009), against a real Postgres and a fake engine. */
let h: Harness;
let api: Api;
let settings: PlatformSettingsService;
let pull: PullService;

const SECRET = 's3cret-value';
const automated: AutomationContext[] = [];
let threads: BridgeConversation[] = [];
let thread: Record<string, BridgeMessage[]> = {};
let fetched: string[] = [];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  settings = h.app.get(PlatformSettingsService);
  pull = h.app.get(PullService);
  h.app.get<InstagramAutomation>(INSTAGRAM_AUTOMATION).automate = (ctx) => {
    automated.push(ctx);
    return Promise.resolve();
  };
  const bridge = h.app.get<InstagramBridgeFactory>(INSTAGRAM_BRIDGE);
  bridge.with = () => ({
    accounts: (q): Promise<BridgeAccount[]> =>
      Promise.resolve(
        q.workspace !== undefined
          ? [{ id: 'A1', username: 'shop', name: 'Shop', avatar: '', connected: true }]
          : [],
      ),
    conversations: () => Promise.resolve(threads),
    messages: (id) => {
      fetched.push(id);
      return Promise.resolve(thread[id] ?? []);
    },
    connectStart: () => Promise.resolve({ ok: true, data: { url: 'https://engine.test/x' } }),
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
  if (on) await settings.setSecret('addons.engine.instagram.secret', SECRET, null);
  else await settings.clearSecret('addons.engine.instagram.secret');
}

beforeEach(async () => {
  automated.length = 0;
  threads = [];
  thread = {};
  fetched = [];
  await engine(true);
});

const push = (body: unknown, secret: string | null = SECRET) => {
  const r = api.http().post('/v2/instaflow/inbound');
  return (secret === null ? r : r.set('X-Instaflow-Secret', secret)).send(body as object);
};

const dm = (t: Tenant, over: Record<string, unknown> = {}, conv: Record<string, unknown> = {}) => ({
  event: 'message',
  workspace_id: t.orgId,
  account: { id: 'A1', username: 'shop', name: 'Shop' },
  conversation: {
    id: 'A1_555',
    name: 'Asha',
    handle: 'asha',
    avatar: 'https://cdn.test/a.png',
    ...conv,
  },
  message: {
    id: 'm1',
    from_me: false,
    type: 'text',
    text: 'hello',
    at: new Date().toISOString(),
    ...over,
  },
});

const rowsOf = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT c.id, c.title, c.preview, c.unread_count, c.contact_id, c.last_inbound_at, c.last_outbound_at, c.raw_jid
       FROM conversations c WHERE c.org_id = $1 AND c.channel = 'instagram' ORDER BY c.id`,
      [t.orgId],
    )
  ).rows;

const messagesOf = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT direction, body, media_type, status, meta, provider FROM messages WHERE org_id = $1 AND provider = 'instagram' ORDER BY id`,
      [t.orgId],
    )
  ).rows;

describe('the push door (TW-IG-007)', () => {
  it('refuses a missing or wrong secret, and everyone while the engine is not connected', async () => {
    const t = await api.signup('igpa');
    expect((await push(dm(t), null)).status).toBe(401);
    expect((await push(dm(t), 'wrong')).status).toBe(401);
    await engine(false);
    const res = await push(dm(t), '');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'unauthorized' });
    expect(await rowsOf(t)).toHaveLength(0);
  });

  it('refuses a body it cannot read and a workspace it does not know, after the secret is proven', async () => {
    const t = await api.signup('igpb');
    const bad = await push({ event: 'nonsense', workspace_id: t.orgId });
    expect(bad.status).toBe(422);
    const unknown = await push({ ...dm(t), workspace_id: 987654321 });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toBe('unknown workspace');
  });

  it('a signed push flips the connection on, and a status or thread event is acknowledged and stores nothing', async () => {
    const t = await api.signup('igpc');
    await settings.mergeMember('addons.engines', 'instagram', { connected: false }, null);
    const res = await push({ event: 'status', workspace_id: t.orgId });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, received: 'status' });
    expect(await rowsOf(t)).toHaveLength(0);
    const hub = await api.http().get('/v2/instagram/accounts').set(bearer(t.admin));
    expect(hub.body.bridge.connected).toBe(true);
  });
});

describe('a message into the inbox (TW-IG-008)', () => {
  it('stores the thread, the message, the contact, the preview, the unread count and the 24 hour clock', async () => {
    const t = await api.signup('igma');
    const res = await push(dm(t));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);

    const [c] = await rowsOf(t);
    expect(c).toMatchObject({
      title: 'Asha',
      preview: 'hello',
      unread_count: 1,
      raw_jid: 'ig:A1_555',
    });
    expect(c.last_inbound_at).not.toBeNull();
    const [m] = await messagesOf(t);
    expect(m).toMatchObject({ direction: 'in', body: 'hello', status: 'received' });
    expect(m.meta.instagram).toMatchObject({
      message_id: 'm1',
      handle: 'asha',
      account: 'shop',
      account_id: 'A1',
    });
    const contact = await h.owner.query(
      `SELECT name, channel, channel_uid FROM contacts WHERE id = $1 AND org_id = $2`,
      [c.contact_id, t.orgId],
    );
    expect(contact.rows[0]).toEqual({ name: 'Asha', channel: 'instagram', channel_uid: 'A1_555' });
    expect(automated).toHaveLength(1);
    expect(automated[0]).toMatchObject({
      orgId: t.orgId,
      text: 'hello',
      trigger: 'dm_keyword',
      accountId: 'A1',
    });
  });

  it('the same message pushed twice is one row, one unread, and no second automation', async () => {
    const t = await api.signup('igmb');
    const first = await push(dm(t));
    const second = await push(dm(t));
    expect(second.body.message_id).toBe(first.body.message_id);
    expect(await messagesOf(t)).toHaveLength(1);
    expect((await rowsOf(t))[0].unread_count).toBe(1);
    expect(automated).toHaveLength(1);
  });

  it('a placeholder title is replaced by a real name later, and an operator’s title is kept', async () => {
    const t = await api.signup('igmc');
    await push(dm(t, { id: 'm1' }, { name: '', handle: '913620425089077' }));
    expect((await rowsOf(t))[0].title).toBe('@913620425089077');
    await push(dm(t, { id: 'm2' }, { name: 'Asha', handle: 'asha' }));
    expect((await rowsOf(t))[0].title).toBe('Asha');
    await h.owner.query(`UPDATE conversations SET title = 'VIP Asha' WHERE org_id = $1`, [t.orgId]);
    await push(dm(t, { id: 'm3' }, { name: 'Asha K', handle: 'asha' }));
    expect((await rowsOf(t))[0].title).toBe('VIP Asha');
  });

  it('our own message is stored outbound with no unread, no contact and no automation', async () => {
    const t = await api.signup('igmd');
    await push(dm(t, { id: 'out1', from_me: true, text: 'we replied' }));
    const [c] = await rowsOf(t);
    expect(c.unread_count).toBe(0);
    expect(c.contact_id).toBeNull();
    expect(c.last_outbound_at).not.toBeNull();
    expect((await messagesOf(t))[0]).toMatchObject({ direction: 'out', status: 'sent' });
    expect(automated).toHaveLength(0);
  });

  it('a test ping and a history message are stored, but make no contact and run no automation', async () => {
    const t = await api.signup('igme');
    await push(dm(t, { id: 't1', is_test: true }));
    await push(dm(t, { id: 'b1', is_backfill: true }, { id: 'A1_777' }));
    expect(await messagesOf(t)).toHaveLength(2);
    expect((await rowsOf(t)).every((c) => c.contact_id === null)).toBe(true);
    expect(automated).toHaveLength(0);
  });

  it('a media message with no text shows [Image] as the preview and keeps its address', async () => {
    const t = await api.signup('igmf');
    await push(dm(t, { id: 'p1', type: 'image', text: '', media_url: 'https://cdn.test/p.jpg' }));
    expect((await rowsOf(t))[0].preview).toBe('[Image]');
    const [m] = await messagesOf(t);
    expect(m.media_type).toBe('image');
    expect(m.meta.instagram.media_url).toBe('https://cdn.test/p.jpg');
  });

  it('a story mention with no text still runs an automation, with its own trigger', async () => {
    const t = await api.signup('igmg');
    await push(dm(t, { id: 's1', type: 'story_mention', text: '', ig_trigger: 'story_mention' }));
    expect(automated).toHaveLength(1);
    expect(automated[0]!.trigger).toBe('story_mention');
  });

  it('buttons are stored as {text, url} and grafted onto a row that was stored without them', async () => {
    const t = await api.signup('igmh');
    await push(dm(t, { id: 'b1', text: 'pick one' }));
    await push(
      dm(t, {
        id: 'b1',
        text: 'pick one',
        buttons: [{ title: 'Yes' }, { title: 'Site', url: 'https://x.test' }],
      }),
    );
    const rows = await messagesOf(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].meta.buttons).toEqual([
      { text: 'Yes' },
      { text: 'Site', url: 'https://x.test' },
    ]);
  });

  it('a write for one organization never lands in another', async () => {
    const a = await api.signup('igmi');
    const b = await api.signup('igmj');
    await push(dm(a));
    expect(await rowsOf(b)).toHaveLength(0);
  });
});

describe('the pull (TW-IG-009)', () => {
  async function linked(t: Tenant): Promise<void> {
    const res = await api
      .http()
      .post('/v2/instagram/accounts')
      .set(bearer(t.admin))
      .send({ instaflowAccountId: 'A1' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  const bm = (id: string, over: Partial<BridgeMessage> = {}): BridgeMessage => ({
    id,
    fromMe: false,
    type: 'text',
    text: `text ${id}`,
    mediaUrl: '',
    buttons: null,
    at: new Date().toISOString(),
    ...over,
  });

  it('stores both directions, counts only new rows, and does nothing for an organization with no linked account', async () => {
    const t = await api.signup('igpu');
    const none = await pull.pull(t.orgId);
    expect(none).toEqual({ ingested: 0, scanned: 0 });

    await linked(t);
    threads = [
      {
        id: 'A1_900',
        account: 'A1',
        name: 'Ravi',
        handle: 'ravi',
        avatar: '',
        lastAt: new Date().toISOString(),
      },
    ];
    thread = { A1_900: [bm('p1'), bm('p2', { fromMe: true, text: 'our reply' })] };
    const first = await pull.pull(t.orgId);
    expect(first).toEqual({ ingested: 2, scanned: 1 });
    expect((await messagesOf(t)).map((m) => m.direction)).toEqual(['in', 'out']);
    expect((await messagesOf(t))[0].meta.instagram.account).toBe('shop');

    const again = await pull.pull(t.orgId, true);
    expect(again).toEqual({ ingested: 0, scanned: 1 });
    expect(await messagesOf(t)).toHaveLength(2);
  });

  it('skips a thread with nothing newer than ours, and reads it again when forced', async () => {
    const t = await api.signup('igpv');
    await linked(t);
    const at = new Date().toISOString();
    threads = [{ id: 'A1_901', account: 'A1', name: 'Mia', handle: 'mia', avatar: '', lastAt: at }];
    thread = { A1_901: [bm('q1', { at })] };
    await pull.pull(t.orgId);
    fetched = [];
    await pull.pull(t.orgId);
    expect(fetched).toEqual([]);
    await pull.pull(t.orgId, true);
    expect(fetched).toEqual(['A1_901']);
  });

  it('a message pushed and then pulled is one row, and a pulled message with no id is not stored', async () => {
    const t = await api.signup('igpw');
    await linked(t);
    await push(
      dm(t, { id: 'dup1', text: 'text dup1' }, { id: 'A1_902', name: 'Zed', handle: 'zed' }),
    );
    threads = [
      {
        id: 'A1_902',
        account: 'A1',
        name: 'Zed',
        handle: 'zed',
        avatar: '',
        lastAt: new Date(Date.now() + 60_000).toISOString(),
      },
    ];
    thread = { A1_902: [bm('dup1', { text: 'text dup1' }), bm('', { text: 'no id' })] };
    const res = await pull.pull(t.orgId);
    expect(res.ingested).toBe(0);
    expect(await messagesOf(t)).toHaveLength(1);
  });

  it('old messages are stored as history and never answered, a fresh one is', async () => {
    const t = await api.signup('igpx');
    await linked(t);
    threads = [
      {
        id: 'A1_903',
        account: 'A1',
        name: 'Kai',
        handle: 'kai',
        avatar: '',
        lastAt: new Date().toISOString(),
      },
    ];
    thread = {
      A1_903: [
        bm('old1', { at: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
        bm('new1', { at: new Date().toISOString() }),
      ],
    };
    await pull.pull(t.orgId);
    expect(await messagesOf(t)).toHaveLength(2);
    expect(automated.map((a) => a.text)).toEqual(['text new1']);
  });
});
