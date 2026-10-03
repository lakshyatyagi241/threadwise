import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  exportCountsResponseSchema,
  notificationPrefsResponseSchema,
  workspaceSettingsResponseSchema,
} from '@crm/contracts';
import {
  Api,
  PASSWORD,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * The customer Settings page's server side end to end (WD-ASHELL-032..044): General, Notifications, Data export, Delete
 * workspace, and the personal preference. One app, one database; each describe block works in a workspace of its own.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  await h.owner.query(
    `INSERT INTO currencies (name, code, symbol, is_active) VALUES ('Indian Rupee','INR','₹',true), ('US Dollar','USD','$',true)
       ON CONFLICT (code) DO UPDATE SET is_active = true`,
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const ws = (token: string) => api.http().get('/v2/shell/workspace').set(bearer(token));
const patchWs = (token: string, body: Record<string, unknown>) =>
  api.http().patch('/v2/shell/workspace').set(bearer(token)).send(body);
const audits = async (orgId: number, event: string) =>
  Number(
    (
      await h.owner.query(
        `SELECT count(*) n FROM security_events WHERE subject_org_id = $1 AND event = $2`,
        [orgId, event],
      )
    ).rows[0].n,
  );

describe('General tab (WD-ASHELL-033)', () => {
  let t: Tenant;
  let member: { token: string };
  beforeAll(async () => {
    t = await api.signup('shgen');
    member = await api.member(t, 'plain', []);
  });

  it('shows the workspace to any member, with the slug, a default timezone and the active currencies', async () => {
    const res = await ws(member.token);
    expect(res.status).toBe(200);
    const body = workspaceSettingsResponseSchema.parse(res.body);
    expect(body.slug).toBe(t.slug);
    expect(body.timezone).toBe('UTC');
    expect(body.isOwner).toBe(false);
    expect(body.currencies.map((c) => c.code)).toEqual(expect.arrayContaining(['INR', 'USD']));
    expect((await ws(t.admin)).body.isOwner).toBe(true);
  });

  it('the owner saves timezone and currency (code upper-cased); the slug never moves; the save is audited', async () => {
    const before = await audits(t.orgId, 'workspace.settings_updated');
    const res = await patchWs(t.admin, {
      name: 'Renamed Co',
      timezone: 'Asia/Kolkata',
      currency: 'inr',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Renamed Co',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      slug: t.slug,
    });
    const row = (
      await h.owner.query(`SELECT name, slug, settings FROM organizations WHERE id = $1`, [t.orgId])
    ).rows[0];
    expect(row).toMatchObject({ name: 'Renamed Co', slug: t.slug });
    expect(row.settings).toMatchObject({ timezone: 'Asia/Kolkata', currency: 'INR' });
    expect(await audits(t.orgId, 'workspace.settings_updated')).toBe(before + 1);
  });

  it('ignores blank fields instead of clearing them', async () => {
    const res = await patchWs(t.admin, { name: '  ', timezone: '', currency: '' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Renamed Co',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    });
  });

  it('a member is refused with the owner-only message and nothing changes', async () => {
    const res = await patchWs(member.token, { timezone: 'Europe/Paris' });
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('Only the workspace owner can edit these.');
    expect((await ws(t.admin)).body.timezone).toBe('Asia/Kolkata');
  });

  it('an unknown timezone or currency is a 422 and writes nothing', async () => {
    const tz = await patchWs(t.admin, { timezone: 'Mars/Base' });
    expect(tz.status).toBe(422);
    const cur = await patchWs(t.admin, { currency: 'ZZZ', name: 'Should not apply' });
    expect(cur.status).toBe(422);
    expect((await ws(t.admin)).body).toMatchObject({
      name: 'Renamed Co',
      timezone: 'Asia/Kolkata',
    });
  });

  it('keeps another workspace out of reach', async () => {
    const other = await api.signup('shgen2');
    expect((await ws(other.admin)).body.name).not.toBe('Renamed Co');
    expect((await ws(other.admin)).body.timezone).toBe('UTC');
  });
});

describe('Notifications tab (WD-ASHELL-038)', () => {
  let t: Tenant;
  let member: { token: string };
  const put = (token: string, body: Record<string, unknown>) =>
    api.http().put('/v2/shell/workspace/notifications').set(bearer(token)).send(body);
  const get = (token: string) =>
    api.http().get('/v2/shell/workspace/notifications').set(bearer(token));
  beforeAll(async () => {
    t = await api.signup('shnot');
    member = await api.member(t, 'plain', []);
  });

  it('starts from WaDesk defaults: critical events light the bell, email is quiet, categories are in-app only', async () => {
    const body = notificationPrefsResponseSchema.parse((await get(t.admin)).body);
    expect(body.events).toHaveLength(18);
    expect(body.categories).toHaveLength(9);
    const ev = (k: string) => body.events.find((e) => e.key === k)!;
    expect(ev('device_connected')).toMatchObject({ inapp: true, email: false, slack: false });
    expect(ev('payment_failed')).toMatchObject({ inapp: true, email: true, slack: false });
    expect(ev('wallet_low_balance')).toMatchObject({ inapp: true, email: true, slack: true });
    expect(ev('weekly_summary')).toMatchObject({ inapp: false, email: true, slack: false });
    expect(body.categories.every((c) => c.inapp && !c.email && !c.slack)).toBe(true);
    expect(body).toMatchObject({ isOwner: true, slackWebhook: null, slackWebhookSet: false });
  });

  it('the owner turns email off for payment_failed; the bell stays on; a channel left out counts as off', async () => {
    const res = await put(t.admin, {
      events: { payment_failed: { inapp: true, email: false }, sla_breached: { slack: true } },
      categories: { chat: { inapp: true, email: true } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = notificationPrefsResponseSchema.parse(res.body);
    const ev = (k: string) => body.events.find((e) => e.key === k)!;
    expect(ev('payment_failed')).toMatchObject({ inapp: true, email: false, slack: false });
    expect(ev('sla_breached')).toMatchObject({ inapp: false, email: false, slack: true });
    // The form posts every row, so a row it omitted was switched off entirely.
    expect(ev('device_disconnected')).toMatchObject({ inapp: false, email: false, slack: false });
    expect(body.categories.find((c) => c.key === 'chat')).toMatchObject({
      inapp: true,
      email: true,
    });
  });

  it('keeps the Slack URL encrypted at rest, shows it to the owner only, and clears it when blank', async () => {
    const url = 'https://hooks.slack.com/services/T000/B000/XXXX';
    const saved = await put(t.admin, { slackWebhook: url });
    expect(saved.body).toMatchObject({ slackWebhook: url, slackWebhookSet: true });
    const stored = (
      await h.owner.query(
        `SELECT settings -> 'notificationPrefs' ->> 'slackWebhookEnc' AS enc, settings::text AS raw FROM organizations WHERE id = $1`,
        [t.orgId],
      )
    ).rows[0];
    expect(stored.enc).toBeTruthy();
    expect(stored.raw).not.toContain('hooks.slack.com');

    const asMember = await get(member.token);
    expect(asMember.body).toMatchObject({
      isOwner: false,
      slackWebhook: null,
      slackWebhookSet: true,
    });

    const kept = await put(t.admin, { events: {} });
    expect(kept.body.slackWebhookSet).toBe(true);
    const cleared = await put(t.admin, { slackWebhook: '' });
    expect(cleared.body).toMatchObject({ slackWebhook: null, slackWebhookSet: false });
  });

  it('rejects a URL that is not a URL, and refuses a member', async () => {
    expect((await put(t.admin, { slackWebhook: 'notaurl' })).status).toBe(422);
    const res = await put(member.token, { events: {} });
    expect(res.status).toBe(403);
  });

  it('leaves an audit row and an outbox event for the dispatcher', async () => {
    expect(await audits(t.orgId, 'workspace.notification_prefs_saved')).toBeGreaterThan(0);
    const ev = await h.owner.query(
      `SELECT count(*) n FROM event_outbox WHERE org_id = $1 AND event_type = 'org.notification_prefs.changed'`,
      [t.orgId],
    );
    expect(Number(ev.rows[0].n)).toBeGreaterThan(0);
  });
});

describe('Data export (WD-ASHELL-043)', () => {
  let t: Tenant;
  let member: { token: string };
  const csv = (token: string, type: string) =>
    api
      .http()
      .get(`/v2/shell/workspace/export/${type}`)
      .set(bearer(token))
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (data += c));
        res.on('end', () => cb(null, data));
      });
  beforeAll(async () => {
    t = await api.signup('shexp');
    member = await api.member(t, 'plain', []);
    await h.owner.query(
      `INSERT INTO contacts (org_id, uuid, name, email, phone, status) VALUES
         ($1, gen_random_uuid(), '=HYPERLINK("http://x")', 'ana@example.test', '+911', 'new'),
         ($1, gen_random_uuid(), 'Bo, "the" Builder', NULL, NULL, NULL)`,
      [t.orgId],
    );
    const ch = await h.owner.query(
      `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'whatsapp', 'Main') RETURNING id`,
      [t.orgId],
    );
    const conv = await h.owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1, $2, '911', 'Ana') RETURNING id`,
      [t.orgId, ch.rows[0].id],
    );
    await h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, body, status)
       VALUES ($1, $2, 1, 'in', 'customer', $3, 'received')`,
      [t.orgId, conv.rows[0].id, 'x'.repeat(700)],
    );
  });

  it('shows the three counts to a member, but only the owner can download', async () => {
    const res = await api.http().get('/v2/shell/workspace/export').set(bearer(member.token));
    expect(exportCountsResponseSchema.parse(res.body)).toMatchObject({
      contacts: 2,
      conversations: 1,
      messages: 1,
      isOwner: false,
    });
    const denied = await csv(member.token, 'contacts');
    expect(denied.status).toBe(403);
  });

  it('streams contacts with WaDesk header, quoting commas and quotes, and neutralising a formula', async () => {
    const res = await csv(t.admin, 'contacts');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('contacts.csv');
    const lines = (res.body as string).trim().split('\n');
    expect(lines[0]).toBe('id,name,mobile,email,status,created_at');
    expect(lines).toHaveLength(3);
    const text = res.body as string;
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).toContain(`"Bo, ""the"" Builder"`);
    expect(text).not.toMatch(/,=HYPERLINK/);
  });

  it('conversations carry the channel kind; messages are cut to 500 characters and name their conversation', async () => {
    const conv = (await csv(t.admin, 'conversations')).body as string;
    expect(conv.split('\n')[0]).toBe('id,channel,status,last_message_at,created_at');
    expect(conv).toContain(',whatsapp,open,');
    const msg = (await csv(t.admin, 'messages')).body as string;
    expect(msg.split('\n')[0]).toBe('id,conversation_id,direction,body,created_at');
    const row = msg.trim().split('\n')[1]!.split(',');
    expect(row[2]).toBe('in');
    expect(row[3]).toHaveLength(500);
  });

  it('refuses an unknown type, never leaks another workspace, and audits the download', async () => {
    expect((await csv(t.admin, 'foo')).status).toBe(422);
    const other = await api.signup('shexp2');
    const theirs = (await csv(other.admin, 'contacts')).body as string;
    expect(theirs.trim().split('\n')).toHaveLength(1);
    expect(await audits(t.orgId, 'workspace.data_exported')).toBeGreaterThanOrEqual(3);
  });
});

describe('Delete workspace (WD-ASHELL-044)', () => {
  let t: Tenant;
  let member: { token: string };
  const del = (token: string, body: Record<string, unknown>) =>
    api.http().delete('/v2/shell/workspace').set(bearer(token)).send(body);
  const name = async () =>
    (await h.owner.query(`SELECT name, status FROM organizations WHERE id = $1`, [t.orgId]))
      .rows[0];
  beforeAll(async () => {
    t = await api.signup('shdel');
    member = await api.member(t, 'plain', []);
  });

  it('refuses a member, a wrong password and a name typed in another case, and deletes nothing', async () => {
    const { name: actual } = await name();
    expect((await del(member.token, { confirmName: actual, password: PASSWORD })).status).toBe(403);
    const wrongPw = await del(t.admin, { confirmName: actual, password: 'not-the-password' });
    expect(wrongPw.status).toBe(422);
    expect(wrongPw.body.errors?.[0]?.path).toBe('password');
    const wrongCase = await del(t.admin, { confirmName: actual.toUpperCase(), password: PASSWORD });
    expect(wrongCase.status).toBe(422);
    expect((await name()).status).toBe('active');
  });

  it('with the exact name and the password the workspace is deleted, every session ends and sign-in stops', async () => {
    const { name: actual } = await name();
    const before = await audits(t.orgId, 'workspace.deleted');
    const res = await del(t.admin, { confirmName: `  ${actual}  `, password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await name()).status).toBe('deleted');
    expect(await audits(t.orgId, 'workspace.deleted')).toBe(before + 1);
    // The owner's and the member's live access tokens both stop working at once.
    expect((await ws(t.admin)).status).toBe(401);
    expect((await ws(member.token)).status).toBe(401);
    const login = await api
      .http()
      .post('/v2/auth/login')
      .set('x-forwarded-for', '10.66.0.9')
      .send({ orgSlug: t.slug, email: 'nobody@example.test', password: PASSWORD });
    expect(login.status).toBeGreaterThanOrEqual(400);
  });
});

describe('Personal preference (WD-ASHELL-035)', () => {
  it('auto AI summarize is off until the person turns it on, and is theirs alone', async () => {
    const t = await api.signup('shpref');
    const member = await api.member(t, 'plain', []);
    const read = (token: string) => api.http().get('/v2/shell/preferences').set(bearer(token));
    expect((await read(t.admin)).body).toEqual({ autoAiSummarize: false });
    const on = await api
      .http()
      .put('/v2/shell/preferences')
      .set(bearer(t.admin))
      .send({ autoAiSummarize: true });
    expect(on.body).toEqual({ autoAiSummarize: true });
    expect((await read(t.admin)).body.autoAiSummarize).toBe(true);
    expect((await read(member.token)).body.autoAiSummarize).toBe(false);
    const bad = await api
      .http()
      .put('/v2/shell/preferences')
      .set(bearer(t.admin))
      .send({ autoAiSummarize: 'yes' });
    expect(bad.status).toBe(422);
  });
});
