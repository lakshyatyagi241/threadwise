import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  conversationOf,
  messagesOf,
  scalar,
  sleep,
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';

/**
 * The consent ledger end to end: the real API, the real inbound ingest and its worker listeners (the consent keyword listener runs
 * first), real Postgres (restricted role, forced RLS) and Redis. The channel is the simulator (a WhatsApp stand-in).
 */
let p: Pipeline;
let t: Tenant;
let ch: SimChannel;

const settings = () => p.api.as(t.admin).get('/v2/contact-consent/settings');
const contactRow = async (phone: string) =>
  (
    await p.h.owner.query(
      `SELECT id, uuid, is_unsubscribed, unsubscribed_at FROM contacts WHERE org_id = $1 AND normalized_phone LIKE $2`,
      [t.orgId, `%${phone.slice(-10)}`],
    )
  ).rows[0] as { id: string; uuid: string; is_unsubscribed: boolean; unsubscribed_at: Date | null };
const events = async (contactId: string) =>
  (
    await p.h.owner.query(
      `SELECT action, source, channel, evidence, idempotency_key FROM contact_consent_events WHERE org_id = $1 AND contact_id = $2 ORDER BY id`,
      [t.orgId, contactId],
    )
  ).rows as Array<{
    action: string;
    source: string;
    channel: string;
    evidence: Record<string, unknown>;
    idempotency_key: string;
  }>;
const botReplies = async (convId: number | string) =>
  (await messagesOf(p, convId)).filter((m) => m.direction === 'out' && m.sender_kind === 'bot');

beforeAll(async () => {
  p = await startPipeline(async () => [
    (await import('../../../src/modules/contact-consent/contact-consent-worker.module'))
      .ContactConsentWorkerModule,
  ]);
  t = await p.api.signup('consent');
  ch = await simChannel(p, t);
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

describe('STOP / START through the real inbound ingest', () => {
  const peer = '919811110001';

  it('STOP opts the contact out, writes the ledger and answers once', async () => {
    await simInbound(p, t, ch, { from: peer, name: 'Sara Ali', text: ' Stop. ' });
    const conv = await conversationOf(p, t, ch, peer);
    await until('contact opted out', async () => (await contactRow(peer))?.is_unsubscribed);
    const c = await contactRow(peer);
    expect(c.unsubscribed_at).not.toBeNull();

    const ev = await events(c.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ action: 'withdrawn', source: 'keyword', channel: 'whatsapp' });
    expect(ev[0]!.evidence).toMatchObject({ keyword: 'stop' });
    // Never the customer's own text, the IP, or anything but the matched keyword and the message id.
    expect(Object.keys(ev[0]!.evidence).sort()).toEqual(['keyword', 'messageId']);

    const replies = await until('one confirmation', async () => {
      const r = await botReplies(conv.id as number);
      return r.length > 0 ? r : undefined;
    });
    expect(replies).toHaveLength(1);
    expect(String(replies[0]!.body)).toMatch(/unsubscribed/i);
    expect(String(replies[0]!.body)).toMatch(/START/);

    // The thread says what happened: one system line on the customer's side, no unread, no assignment, no wait clock.
    const lines = (await messagesOf(p, conv.id as number)).filter((m) => m.kind === 'system');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      direction: 'in',
      body: 'Contact replied STOP: unsubscribed from marketing',
    });
    expect(lines[0]!.meta).toMatchObject({
      event: 'consent',
      consentAction: 'withdrawn',
      consentKeyword: 'stop',
    });
    const convRow = await conversationOf(p, t, ch, peer);
    expect(Number(convRow.unread_count)).toBe(1); // only the STOP itself, not the line
    expect(convRow.assignee_user_id ?? null).toBeNull();
  });

  it('the thread API words the line for the reader (systemEvent) and keeps the English body', async () => {
    const conv = await conversationOf(p, t, ch, peer);
    const res = await p.api
      .as(t.admin)
      .get(`/v2/inbox/conversations/${conv.uuid as string}/messages`)
      .query({ limit: 50 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const line = (res.body.data as Array<Record<string, unknown>>).find((m) => m.kind === 'system');
    expect(line).toMatchObject({
      body: 'Contact replied STOP: unsubscribed from marketing',
      systemEvent: { event: 'consent', action: 'withdrawn', keyword: 'stop' },
    });
  });

  it('a second STOP adds history but no second confirmation and no state change', async () => {
    await simInbound(p, t, ch, { from: peer, text: 'STOP' });
    await sleep(1500);
    const conv = await conversationOf(p, t, ch, peer);
    expect(await botReplies(conv.id as number)).toHaveLength(1);
    const c = await contactRow(peer);
    expect(c.is_unsubscribed).toBe(true);
    // No state change, so no second line either.
    const lines = (await messagesOf(p, conv.id as number)).filter((m) => m.kind === 'system');
    expect(lines).toHaveLength(1);
  });

  it('a sentence that contains stop does nothing', async () => {
    const other = '919811110002';
    await simInbound(p, t, ch, {
      from: other,
      name: 'Omar',
      text: 'please stop sending me invoices',
    });
    const conv = await conversationOf(p, t, ch, other);
    await sleep(1500);
    const c = await contactRow(other);
    expect(c.is_unsubscribed).toBe(false);
    expect(await events(c.id)).toHaveLength(0);
    expect(await botReplies(conv.id as number)).toHaveLength(0);
  });

  it('START resubscribes, records a grant and says how to stop again', async () => {
    await simInbound(p, t, ch, { from: peer, text: 'START' });
    await until('contact subscribed again', async () => {
      const c = await contactRow(peer);
      return c.is_unsubscribed === false;
    });
    const c = await contactRow(peer);
    const ev = await events(c.id);
    expect(ev.map((e) => e.action)).toEqual(['withdrawn', 'withdrawn', 'granted']);
    const conv = await conversationOf(p, t, ch, peer);
    const replies = await until('the START confirmation', async () => {
      const r = await botReplies(conv.id as number);
      return r.length === 2 ? r : undefined;
    });
    expect(String(replies[1]!.body)).toMatch(/STOP/);
  });

  it('an Arabic keyword works and is answered in Arabic', async () => {
    const other = '919811110003';
    await simInbound(p, t, ch, { from: other, name: 'Layla', text: 'توقف' });
    await until('opted out', async () => (await contactRow(other))?.is_unsubscribed);
    const conv = await conversationOf(p, t, ch, other);
    const r = await until('arabic reply', async () => {
      const m = await botReplies(conv.id as number);
      return m.length > 0 ? m : undefined;
    });
    expect(String(r[0]!.body)).toMatch(/[؀-ۿ]/);
  });

  it('detection can be switched off per workspace', async () => {
    const cur = (await settings()).body as Record<string, unknown> & { rowVersion: number | null };
    const { rowVersion, updatedAt: _u, ...values } = cur;
    const save = await p.api
      .as(t.admin)
      .patch('/v2/contact-consent/settings')
      .send({ ...values, detectionEnabled: false, rowVersion: rowVersion ?? undefined });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    // The listener caches for a minute; the saving process is invalidated at once and the test shares it.
    const other = '919811110004';
    await simInbound(p, t, ch, { from: other, text: 'stop' });
    await conversationOf(p, t, ch, other);
    await sleep(1500);
    expect((await contactRow(other)).is_unsubscribed).toBe(false);
    await p.api
      .as(t.admin)
      .patch('/v2/contact-consent/settings')
      .send({ ...values, detectionEnabled: true, rowVersion: save.body.rowVersion });
  });
});

describe('the ledger is append-only and isolated', () => {
  it('UPDATE and DELETE on an event are refused, even for the table owner', async () => {
    const id = (
      await p.h.owner.query(
        `SELECT id FROM contact_consent_events WHERE org_id = $1 ORDER BY id LIMIT 1`,
        [t.orgId],
      )
    ).rows[0].id;
    await expect(
      p.h.owner.query(`UPDATE contact_consent_events SET action = 'granted' WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      p.h.owner.query(`DELETE FROM contact_consent_events WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
  });

  it('erasing a contact anonymises its events instead of editing or deleting them', async () => {
    const other = '919811110005';
    await simInbound(p, t, ch, { from: other, text: 'unsubscribe' });
    await until('opted out', async () => (await contactRow(other))?.is_unsubscribed);
    const c = await contactRow(other);
    const before = await scalar(
      p,
      `SELECT count(*) AS n FROM contact_consent_events WHERE org_id = $1`,
      [t.orgId],
    );
    await p.h.owner.query(`DELETE FROM contacts WHERE org_id = $1 AND id = $2`, [t.orgId, c.id]);
    expect(
      await scalar(p, `SELECT count(*) AS n FROM contact_consent_events WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(before);
    expect(
      await scalar(
        p,
        `SELECT count(*) AS n FROM contact_consent_events WHERE org_id = $1 AND contact_id = $2`,
        [t.orgId, c.id],
      ),
    ).toBe(0);
  });

  it('another workspace sees none of it', async () => {
    const other = await p.api.signup('consentb');
    const list = await p.api.as(other.admin).get('/v2/contact-consent/events');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);
    const mine = await p.api.as(t.admin).get('/v2/contact-consent/events');
    expect(mine.body.data.length).toBeGreaterThan(0);
    const rows = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM contact_consent_events WHERE org_id = $1`,
      [other.orgId],
    );
    expect(rows.rows[0].n).toBe(0);
  });
});

describe('manual consent, idempotency, export, permissions', () => {
  let contactUuid: string;
  beforeAll(async () => {
    const res = await p.api
      .as(t.admin)
      .post('/v2/contacts')
      .set('idempotency-key', `c-${Math.random()}`)
      .send({ name: 'Manual Person', phone: '+919822220001' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    contactUuid = res.body.id as string;
  });

  const post = (body: Record<string, unknown>, key?: string) => {
    const r = p.api.as(t.admin).post(`/v2/contact-consent/contacts/${contactUuid}/events`);
    return (
      key ? r.set('idempotency-key', key) : r.set('idempotency-key', `k-${Math.random()}`)
    ).send(body);
  };

  it('a new contact has no consent recorded (we never invent it)', async () => {
    const r = await p.api.as(t.admin).get(`/v2/contact-consent/contacts/${contactUuid}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ optedOut: false, states: [], events: [] });
  });

  it('a grant needs a reason', async () => {
    const r = await post({ action: 'granted' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('CONSENT_NOTE_REQUIRED');
  });

  it('a grant is recorded with its note and actor, and a repeat with the same key records nothing', async () => {
    const key = `same-${Math.random()}`;
    const a = await post({ action: 'granted', note: 'Signed the paper form at the counter' }, key);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const b = await post({ action: 'granted', note: 'Signed the paper form at the counter' }, key);
    expect(b.status).toBe(201);
    const r = await p.api.as(t.admin).get(`/v2/contact-consent/contacts/${contactUuid}`);
    expect(r.body.states).toEqual([
      expect.objectContaining({ channel: 'whatsapp', purpose: 'marketing', state: 'granted' }),
    ]);
    expect(r.body.events).toHaveLength(1);
    expect(r.body.events[0]).toMatchObject({ source: 'manual', action: 'granted' });
    expect(r.body.events[0].actor).not.toBeNull();
  });

  it('withdrawing syncs contacts.is_unsubscribed, and granting again clears it', async () => {
    const w = await post({ action: 'withdrawn', note: 'Asked by phone' });
    expect(w.status, JSON.stringify(w.body)).toBe(201);
    expect(w.body.optedOut).toBe(true);
    const row = await p.h.owner.query(`SELECT is_unsubscribed FROM contacts WHERE uuid = $1`, [
      contactUuid,
    ]);
    expect(row.rows[0].is_unsubscribed).toBe(true);
    const g = await post({ action: 'granted', note: 'Changed their mind, by email' });
    expect(g.body.optedOut).toBe(false);
    const row2 = await p.h.owner.query(`SELECT is_unsubscribed FROM contacts WHERE uuid = $1`, [
      contactUuid,
    ]);
    expect(row2.rows[0].is_unsubscribed).toBe(false);
  });

  it('the toggle on the contact record writes the ledger too', async () => {
    const cur = await p.api.as(t.admin).get(`/v2/contacts/${contactUuid}`);
    const res = await p.api
      .as(t.admin)
      .patch(`/v2/contacts/${contactUuid}`)
      .send({ isUnsubscribed: true, rowVersion: cur.body.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = await p.api.as(t.admin).get(`/v2/contact-consent/contacts/${contactUuid}`);
    expect(r.body.optedOut).toBe(true);
    expect(r.body.events[0]).toMatchObject({ action: 'withdrawn', source: 'manual' });
  });

  it('exports CSV proof with formula-safe cells', async () => {
    await post({ action: 'granted', note: '=HYPERLINK("http://x")' });
    const r = await p.api.as(t.admin).get(`/v2/contact-consent/contacts/${contactUuid}/export`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text.split('\r\n')[0]).toBe(
      'contact_id,channel,purpose,action,source,occurred_at,recorded_at,recorded_by,note,evidence',
    );
    expect(r.text).toContain(`'=HYPERLINK`);
    expect(r.text).not.toMatch(/,=HYPERLINK/);
    const all = await p.api.as(t.admin).get('/v2/contact-consent/export');
    expect(all.status).toBe(200);
  });

  it('each key opens only its own routes', async () => {
    const none = await p.api.member(t, 'nokeys', [['record.contacts.read']]);
    expect((await p.api.as(none.token).get('/v2/contact-consent/settings')).status).toBe(403);
    expect(
      (await p.api.as(none.token).get(`/v2/contact-consent/contacts/${contactUuid}`)).status,
    ).toBe(403);
    const reader = await p.api.member(t, 'reader', [['contacts.consent.read']]);
    expect(
      (await p.api.as(reader.token).get(`/v2/contact-consent/contacts/${contactUuid}`)).status,
    ).toBe(200);
    expect(
      (
        await p.api
          .as(reader.token)
          .post(`/v2/contact-consent/contacts/${contactUuid}/events`)
          .set('idempotency-key', 'x1')
          .send({ action: 'withdrawn' })
      ).status,
    ).toBe(403);
    expect((await p.api.as(reader.token).get('/v2/contact-consent/export')).status).toBe(403);
    expect((await p.api.http().get('/v2/contact-consent/settings')).status).toBe(401);
  });
});

describe('settings and the test box', () => {
  it('defaults: detection on, auto reply on, policy switch off, the documented keywords', async () => {
    const other = await p.api.signup('consentc');
    const r = await p.api.as(other.admin).get('/v2/contact-consent/settings');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      detectionEnabled: true,
      autoReplyEnabled: true,
      requireConsentForMarketing: false,
      rowVersion: null,
    });
    expect(r.body.optOutKeywords.en).toEqual(
      expect.arrayContaining([
        'STOP',
        'STOPALL',
        'UNSUBSCRIBE',
        'CANCEL',
        'END',
        'QUIT',
        'OPT OUT',
      ]),
    );
    expect(r.body.footerText.en).toBe('Reply STOP to unsubscribe');
  });

  it('the test box says what would happen, with unsaved edits, without changing anything', async () => {
    const a = await p.api
      .as(t.admin)
      .post('/v2/contact-consent/settings/test')
      .send({ text: 'halt' });
    expect(a.body.outcome).toBe('no_match');
    const b = await p.api
      .as(t.admin)
      .post('/v2/contact-consent/settings/test')
      .send({ text: 'HALT!', optOutKeywords: { en: ['halt'] } });
    expect(b.body).toMatchObject({ outcome: 'opts_out', match: 'opt_out', keyword: 'halt' });
    expect(b.body.reply).toMatch(/unsubscribed/i);
  });

  it('refuses a keyword that is only punctuation and a stale version', async () => {
    const cur = (await settings()).body as Record<string, unknown> & { rowVersion: number | null };
    const { rowVersion, updatedAt: _u, ...values } = cur;
    const bad = await p.api
      .as(t.admin)
      .patch('/v2/contact-consent/settings')
      .send({ ...values, optOutKeywords: { en: ['!!!'] }, rowVersion: rowVersion ?? undefined });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('CONSENT_SETTINGS_INVALID');
    const stale = await p.api
      .as(t.admin)
      .patch('/v2/contact-consent/settings')
      .send({ ...values, rowVersion: (rowVersion ?? 0) + 50 });
    expect(stale.status).toBe(409);
  });

  it('the policy switch drops contacts without a recorded grant from the sendable set; withdrawn are always dropped', async () => {
    const { BroadcastsRepository } =
      await import('../../../src/modules/broadcasts/broadcasts.repository');
    const { DatabaseService } = await import('../../../src/infra/db/database.service');
    const repo = p.h.app.get(BroadcastsRepository);
    const db = p.h.app.get(DatabaseService);
    const mk = async (name: string, phone: string) =>
      (
        await p.api
          .as(t.admin)
          .post('/v2/contacts')
          .set('idempotency-key', `m-${Math.random()}`)
          .send({ name, phone })
      ).body.id as string;
    const unknownU = await mk('Unknown', '+919833330001');
    const grantedU = await mk('Granted', '+919833330002');
    const withdrawnU = await mk('Withdrawn', '+919833330003');
    const rec = (u: string, body: Record<string, unknown>) =>
      p.api
        .as(t.admin)
        .post(`/v2/contact-consent/contacts/${u}/events`)
        .set('idempotency-key', `r-${Math.random()}`)
        .send(body);
    await rec(grantedU, { action: 'granted', note: 'form' });
    await rec(withdrawnU, { action: 'withdrawn' });
    const ids = (
      await p.h.owner.query(`SELECT id FROM contacts WHERE uuid = ANY($1::uuid[]) ORDER BY id`, [
        [unknownU, grantedU, withdrawnU],
      ])
    ).rows.map((r) => Number(r.id));
    const [uId, gId] = ids as [number, number, number];
    const off = await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
      repo.sendableIds(tx, t.orgId, ids, false),
    );
    expect([...off].sort()).toEqual([uId, gId].sort());
    const on = await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
      repo.sendableIds(tx, t.orgId, ids, true),
    );
    expect([...on]).toEqual([gId]);
  });
});

describe('contact import consent step', () => {
  const csv = (rows: string[]) => `name,phone\n${rows.join('\n')}\n`;
  const importFile = (rows: string[], options?: Record<string, unknown>) => {
    let req = p.api
      .as(t.admin)
      .post('/v2/contacts/import')
      .attach('file', Buffer.from(csv(rows)), 'people-2026.csv');
    if (options) req = req.field('options', JSON.stringify(options));
    return req;
  };
  const ledgerFor = async (phone: string) =>
    (
      await p.h.owner.query(
        `SELECT e.action, e.source, e.evidence FROM contact_consent_events e
         JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
         WHERE e.org_id = $1 AND c.phone = $2 ORDER BY e.id`,
        [t.orgId, phone],
      )
    ).rows as Array<{ action: string; source: string; evidence: Record<string, string> }>;

  it('an import without the confirmation records no consent', async () => {
    const res = await importFile(['Plain Import,+919844440001']);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(await ledgerFor('+919844440001')).toHaveLength(0);
  });

  it('with the confirmation every contact gets a grant with the file name as proof, and an opt-out is never overridden', async () => {
    const res = await importFile(['Confirmed One,+919844440002', 'Confirmed Two,+919844440003'], {
      consentConfirmed: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const one = await ledgerFor('+919844440002');
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ action: 'granted', source: 'import' });
    expect(one[0]!.evidence.fileName).toBe('people-2026.csv');
    expect(Object.keys(one[0]!.evidence).sort()).toEqual(['fileName', 'reference']);

    // Opt one of them out, import the same numbers again with the confirmation: the opt-out stands.
    const row = await p.h.owner.query(
      `SELECT uuid FROM contacts WHERE org_id = $1 AND phone = $2`,
      [t.orgId, '+919844440003'],
    );
    const w = await p.api
      .as(t.admin)
      .post(`/v2/contact-consent/contacts/${row.rows[0].uuid}/events`)
      .set('idempotency-key', `w-${Math.random()}`)
      .send({ action: 'withdrawn', note: 'asked' });
    expect(w.status).toBe(201);
    const again = await importFile(['Confirmed Two,+919844440003'], { consentConfirmed: true });
    expect(again.status, JSON.stringify(again.body)).toBeLessThan(300);
    const c = await contactRow('+919844440003');
    expect(c.is_unsubscribed).toBe(true);
  });
});
