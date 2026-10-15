import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { UNOFFICIAL_WHATSAPP_GATE } from '../../../src/modules/auth/unofficial-whatsapp.port';
import {
  EngineSenderRegistry,
  LinkTracker,
  PACING_SETTINGS,
  PacingRuntime,
  SENDER_DIRECTORY,
  SenderLease,
  TEMPLATE_DIRECTORY,
  WALLET_GATE,
  WARMER_GATE,
  type EngineSender,
  type SenderDirectory,
} from '../../../src/modules/broadcasts';
import {
  CAMPAIGN_BILLING,
  CAMPAIGN_FLOW_STARTER,
  CAMPAIGN_SETTINGS,
} from '../../../src/modules/campaigns/_shims/tokens';
import { CampaignDispatchService } from '../../../src/modules/campaigns/campaign-dispatch.service';
import { CampaignEvents } from '../../../src/modules/campaigns/campaign-events';
import { CampaignMirrorService } from '../../../src/modules/campaigns/campaign-mirror.service';
import { CampaignsRepository } from '../../../src/modules/campaigns/campaigns.repository';
import { MergeTagService } from '../../../src/modules/crm';
import {
  ConsentGate,
  ConsentPolicyService,
  ContactConsentService,
} from '../../../src/modules/contact-consent';
import { MailLimits } from '../../../src/modules/channel-email/mail-limits';
import { bearer, type Tenant } from '../contacts-attributes-tags/support';
import { until } from '../chat-conversations/pipeline-support';
import {
  connectMailbox,
  mailWorkspace,
  setMailPlan,
  startMailRig,
  type MailRig,
} from '../channel-email/support';

/**
 * Sending a campaign by email (Reference's `?channel=email`): the real API, worker-side processors and Postgres, and Gmail as a local
 * stand-in (the same fake the mailbox specs use), so the real engine, mailbox token service, send guard, consent gate, unsubscribe
 * link and inbox thread run and only Google is fake. Nothing here talks to a real mailbox.
 */
let rig: MailRig;
let dispatch: CampaignDispatchService;
let registry: EngineSenderRegistry;
let limits: MailLimits;
let redis: Redis;

beforeAll(async () => {
  rig = await startMailRig();
  const get = <T>(token: unknown) => rig.p.h.app.get<T>(token as never, { strict: false });
  // The dispatcher is a worker-side provider; built here from the app's own parts (as the dispatch spec does) so the test, and no
  // background processor or sweeper, decides when a run happens.
  const runtime = get<PacingRuntime>(PacingRuntime);
  runtime.sleep = () => Promise.resolve();
  dispatch = new CampaignDispatchService(
    get<DatabaseService>(DatabaseService),
    get<CampaignsRepository>(CampaignsRepository),
    get<CryptoService>(CryptoService),
    get<CampaignEvents>(CampaignEvents),
    get<CampaignMirrorService>(CampaignMirrorService),
    get<EngineSenderRegistry>(EngineSenderRegistry),
    get<MergeTagService>(MergeTagService),
    get<LinkTracker>(LinkTracker),
    runtime,
    get<SenderLease>(SenderLease),
    get(SENDER_DIRECTORY),
    get(UNOFFICIAL_WHATSAPP_GATE),
    get(TEMPLATE_DIRECTORY),
    get(WARMER_GATE),
    get(PACING_SETTINGS),
    get(CAMPAIGN_BILLING),
    get(CAMPAIGN_FLOW_STARTER),
    get(CAMPAIGN_SETTINGS),
    get<ConsentPolicyService>(ConsentPolicyService),
    get<ConsentGate>(ConsentGate),
  );
  registry = get<EngineSenderRegistry>(EngineSenderRegistry);
  limits = get<MailLimits>(MailLimits);
  redis = get<Redis>(REDIS_CLIENT);
}, 240_000);

afterAll(async () => {
  await rig?.restore();
});

const api = () => rig.p.api;
const q = async (text: string, params: unknown[] = []) =>
  (await rig.p.h.owner.query(text, params)).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

let seq = 0;

interface Rig {
  t: Tenant;
  /** The mailbox's address: one per workspace, so a spec reads only the mail its own campaign sent. */
  address: string;
  mailbox: string;
  channelUuid: string;
}

/** A workspace with the Email add-on and a connected, synced mailbox. */
async function workspace(label: string): Promise<Rig> {
  const address = `sales${seq + 1}@acme.test`;
  const t = await mailWorkspace(rig.p, `${label}${++seq}`);
  await connectMailbox(rig, t, rig.fake.account(address, 'Acme Sales'));
  const row = (
    await q(`SELECT uuid, channel_uuid FROM mail_mailboxes WHERE org_id = $1 AND address = $2`, [
      t.orgId,
      address,
    ])
  )[0]!;
  await until('first sync', async () =>
    (await q(`SELECT last_synced_at FROM mail_mailboxes WHERE uuid = $1`, [row.uuid]))[0]
      ?.last_synced_at
      ? true
      : undefined,
  );
  const fresh = (
    await q(`SELECT channel_uuid FROM mail_mailboxes WHERE uuid = $1`, [row.uuid])
  )[0]!;
  return { t, address, mailbox: row.uuid as string, channelUuid: fresh.channel_uuid as string };
}

const post = (t: Tenant, body: object) =>
  api()
    .http()
    .post('/v2/campaigns')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body);

interface Person {
  name: string;
  email?: string | null;
  phone?: string | null;
  isUnsubscribed?: boolean;
}
let phoneSeq = 0;

/** An email campaign through the API (so every column is as the app writes it), run once by the dispatcher. */
async function campaign(
  w: Rig,
  people: Person[],
  extra: Record<string, unknown> = {},
): Promise<{ id: number; uuid: string; contactIds: string[] }> {
  const contactIds = await api().seedContacts(
    w.t,
    people.map((p) => ({
      name: p.name,
      email: p.email ?? null,
      phone: p.phone ?? `+9197${String(++phoneSeq).padStart(8, '0')}`,
      isUnsubscribed: p.isUnsubscribed ?? false,
    })),
  );
  const res = await post(w.t, {
    name: 'May offer',
    type: 'custom',
    customMessage: 'Hello {{name}}, our offer & news',
    customHeader: 'Your offer, {{name}}',
    scheduleType: 'now',
    senderKey: `email:${w.mailbox}`,
    contactIds,
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (
    await q(`SELECT id, uuid FROM wpcampaigns WHERE uuid = $1`, [res.body.campaign.id])
  )[0]!;
  return { id: Number(row.id), uuid: row.uuid as string, contactIds };
}

const rows = (id: number) =>
  q(
    `SELECT r.status, r.send_attempts, r.error_message, r.whatsapp_message_id, c.name
       FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
      WHERE r.campaign_id = $1 ORDER BY r.id`,
    [id],
  );
const camp = async (id: number) =>
  (
    await q(
      `SELECT status, schedule_type, sent_count, failed_count, custom_footer, throttle_min_sec, daily_limit,
              tracking_enabled, provider, device_id
         FROM wpcampaigns WHERE id = $1`,
      [id],
    )
  )[0]!;
/** A run as the worker's job makes it: as the system, on behalf of the workspace. */
const run = (w: Rig, id: number) =>
  RequestContextStore.run(
    {
      requestId: `camp-${id}`,
      orgId: w.t.orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    () => dispatch.run(w.t.orgId, id),
  );

/** The header block of a raw message, unfolded. */
const headers = (raw: string) => raw.split(/\r?\n\r?\n/)[0]!.replace(/\r?\n[ \t]+/g, ' ');
const header = (raw: string, name: string) =>
  new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(headers(raw))?.[1]?.trim();

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe('an email campaign sends one mail per contact from the mailbox', () => {
  it('sends the typed message with the merged subject, the unsubscribe link and a thread in the inbox', async () => {
    const w = await workspace('send');
    const c = await campaign(w, [
      { name: 'Asha', email: 'asha@buyer.test' },
      { name: 'Ravi', email: 'Ravi@Buyer.test' },
    ]);
    // Created through the API: the sender is the mailbox, the form holds what a mail can carry (and the wallet was never asked).
    expect(await camp(c.id)).toMatchObject({
      status: 'running',
      provider: 'email',
      custom_footer: null,
      throttle_min_sec: null,
      daily_limit: null,
      tracking_enabled: false,
    });

    expect(await run(w, c.id)).toBe('finished');

    const sent = rig.fake.sentTo(w.address).filter((m) => /asha@|ravi@/i.test(headers(m.raw)));
    expect(sent).toHaveLength(2);
    const asha = sent.find((m) => /asha@buyer\.test/i.test(header(m.raw, 'To') ?? ''))!;
    expect(header(asha.raw, 'Subject')).toBe('Your offer, Asha');
    expect(header(asha.raw, 'From')).toContain(w.address);
    // The address is lower-cased before it is used.
    expect(sent.map((m) => header(m.raw, 'To')?.toLowerCase())).toContain('ravi@buyer.test');
    // The body is HTML-escaped plain text with a text twin, and the mail can be unsubscribed from in one click (RFC 8058).
    expect(asha.raw).toContain('Hello Asha, our offer &amp; news');
    expect(asha.raw).toContain('Hello Asha, our offer & news');
    expect(header(asha.raw, 'List-Unsubscribe')).toMatch(/consent\/unsubscribe\//);
    expect(header(asha.raw, 'List-Unsubscribe-Post')).toBe('List-Unsubscribe=One-Click');
    expect(asha.raw).toMatch(/Unsubscribe: http/);

    expect((await rows(c.id)).map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(await camp(c.id)).toMatchObject({ status: 'completed', sent_count: 2, failed_count: 0 });

    // Each mail is a message of the mailbox's inbox thread, written by the campaign, with its subject.
    const msgs = await q(
      `SELECT m.body, m.status, m.meta, c.contact_id FROM messages m
         JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
        WHERE m.org_id = $1 AND m.meta->>'source' = 'campaign' ORDER BY m.id`,
      [w.t.orgId],
    );
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ body: 'Hello Asha, our offer & news', status: 'sent' });
    expect(msgs[0]!.meta.email).toMatchObject({
      subject: 'Your offer, Asha',
      delivery: 'sent',
    });
    expect(msgs[0]!.contact_id).not.toBeNull();
  });

  it('the recipients tab shows the address where other campaigns show the phone', async () => {
    const w = await workspace('tab');
    const c = await campaign(w, [{ name: 'Asha', email: 'asha@buyer.test' }]);
    await run(w, c.id);
    const res = await api().http().get(`/v2/campaigns/${c.uuid}/recipients`).set(bearer(w.t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).toContain('asha@buyer.test');
  });

  it('a blank Header falls back to the campaign name', async () => {
    const w = await workspace('subj');
    const c = await campaign(w, [{ name: 'Asha', email: 'asha@buyer.test' }], {
      name: 'Spring clearance',
      customHeader: '',
    });
    await run(w, c.id);
    const mail = rig.fake.sentTo(w.address).find((m) => /asha@buyer/i.test(headers(m.raw)))!;
    expect(header(mail.raw, 'Subject')).toBe('Spring clearance');
  });

  it('a line break that arrives through a contact value cannot open a second header', async () => {
    const w = await workspace('inj');
    const c = await campaign(w, [{ name: 'Eve\r\nBcc: boss@evil.test', email: 'eve@buyer.test' }]);
    await run(w, c.id);
    const mail = rig.fake.sentTo(w.address).find((m) => /eve@buyer/i.test(headers(m.raw)))!;
    expect(header(mail.raw, 'Subject')).toBe('Your offer, Eve Bcc: boss@evil.test');
    expect(header(mail.raw, 'Bcc')).toBeUndefined();
    // No header line of its own: what was a line break is one space inside the Subject.
    expect(headers(mail.raw)).not.toMatch(/^Bcc:/im);
  });
});

describe('who is mailed', () => {
  it('drops opted-out contacts, skips contacts with no address and duplicate addresses, and mails the rest once', async () => {
    const w = await workspace('who');
    const c = await campaign(w, [
      { name: 'Asha', email: 'asha@buyer.test' },
      { name: 'Out', email: 'out@buyer.test', isUnsubscribed: true },
      { name: 'Nomail', email: null },
      { name: 'Asha twin', email: 'ASHA@buyer.test' },
      { name: 'Blank', email: '   ' },
    ]);
    expect(await run(w, c.id)).toBe('finished');
    const by = Object.fromEntries((await rows(c.id)).map((r) => [r.name, r]));
    expect(by['Asha']).toMatchObject({ status: 'sent' });
    expect(by['Out']).toMatchObject({ status: 'unsubscribed' });
    expect(by['Nomail']).toMatchObject({
      status: 'skipped',
      error_message: 'No email address on this contact',
    });
    expect(by['Blank']).toMatchObject({ status: 'skipped' });
    expect(by['Asha twin']).toMatchObject({
      status: 'skipped',
      error_message: 'Duplicate email address — already sent on this run',
    });
    const mails = rig.fake.sentTo(w.address).filter((m) => /@buyer\.test/i.test(headers(m.raw)));
    expect(mails.map((m) => header(m.raw, 'To')?.toLowerCase())).toEqual(['asha@buyer.test']);
    // Nobody failed: a contact with no address or a repeat is not a send failure.
    expect(await camp(c.id)).toMatchObject({ status: 'completed', sent_count: 1, failed_count: 0 });
  });

  it('a contact who withdrew on the email channel is never mailed', async () => {
    const w = await workspace('ledger');
    const c = await campaign(w, [{ name: 'Gone', email: 'gone@buyer.test' }]);
    const contactId = Number(
      (
        await q(`SELECT id FROM contacts WHERE org_id = $1 AND email = 'gone@buyer.test'`, [
          w.t.orgId,
        ])
      )[0]!.id,
    );
    await RequestContextStore.run(
      {
        requestId: randomUUID(),
        orgId: w.t.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        rig.p.h.app.get(DatabaseService, { strict: false }).txAs({ orgId: w.t.orgId }, (tx) =>
          rig.p.h.app.get(ContactConsentService, { strict: false }).recordInTx(tx, w.t.orgId, {
            contactId,
            channel: 'email',
            action: 'withdrawn',
            source: 'contact_request',
            idempotencyKey: `k-${randomUUID()}`,
          }),
        ),
    );
    await run(w, c.id);
    expect(rig.fake.sentTo(w.address).some((m) => /gone@buyer/i.test(headers(m.raw)))).toBe(false);
    expect((await rows(c.id))[0]).toMatchObject({ status: 'unsubscribed' });
  });

  it('an address that hard-bounced is refused for good, with the reason, and is not retried', async () => {
    const w = await workspace('bounce');
    const c = await campaign(w, [
      { name: 'Bad', email: 'bad@buyer.test' },
      { name: 'Good', email: 'good@buyer.test' },
    ]);
    await limits.flagBounced(w.t.orgId, 'bad@buyer.test', 3600);
    await run(w, c.id);
    const by = Object.fromEntries((await rows(c.id)).map((r) => [r.name, r]));
    expect(by['Good']).toMatchObject({ status: 'sent' });
    expect(by['Bad']!.status).toBe('failed');
    expect(by['Bad']!.error_message).toMatch(/bad@buyer\.test did not accept earlier mail/);
    // Final at once: the retry attempts are not spent on an address that cannot work.
    expect(Number(by['Bad']!.send_attempts)).toBeGreaterThanOrEqual(3);
    expect(rig.fake.sentTo(w.address).some((m) => /bad@buyer/i.test(headers(m.raw)))).toBe(false);
  });

  it('an unsubscribe from the mail itself stops the next campaign', async () => {
    const w = await workspace('unsub');
    const first = await campaign(w, [{ name: 'Una', email: 'una@buyer.test' }]);
    await run(w, first.id);
    const mail = rig.fake.sentTo(w.address).find((m) => /una@buyer/i.test(headers(m.raw)))!;
    const url = /<(https?:[^>]+)>/.exec(header(mail.raw, 'List-Unsubscribe') ?? '')![1]!;
    const res = await api().http().post(new URL(url).pathname).send('List-Unsubscribe=One-Click');
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    const again = await api()
      .http()
      .post('/v2/campaigns')
      .set(bearer(w.t.admin))
      .set('idempotency-key', randomUUID())
      .send({
        name: 'Again',
        type: 'custom',
        customMessage: 'Second',
        scheduleType: 'now',
        senderKey: `email:${w.mailbox}`,
        contactIds: first.contactIds,
      });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const id = Number(
      (await q(`SELECT id FROM wpcampaigns WHERE uuid = $1`, [again.body.campaign.id]))[0]!.id,
    );
    await run(w, id);
    expect((await rows(id))[0]).toMatchObject({ status: 'unsubscribed' });
  });
});

describe('the form of an email campaign', () => {
  const base = (w: Rig, over: object = {}) => ({
    name: 'Offer',
    type: 'custom',
    customMessage: 'Hi',
    scheduleType: 'now',
    senderKey: `email:${w.mailbox}`,
    ...over,
  });
  const problems = (res: { body: { errors?: Array<{ path: string }>; details?: unknown } }) =>
    JSON.stringify(res.body);

  it('refuses a template, a flow, an A/B test, an attachment and a subject over 150 characters', async () => {
    const w = await workspace('form');
    const ids = await api().seedContacts(w.t, [{ name: 'A', email: 'a@buyer.test' }]);
    for (const [over, path] of [
      [{ type: 'template' }, 'type'],
      [{ type: 'flow' }, 'type'],
      [{ abTesting: true }, 'abTesting'],
      [{ mediaUrl: 'https://x.test/a.png' }, 'mediaUrl'],
      [{ customHeader: 'x'.repeat(151) }, 'customHeader'],
    ] as const) {
      const res = await post(w.t, { ...base(w, over), contactIds: ids });
      expect(res.status, JSON.stringify(over)).toBe(422);
      expect(problems(res), JSON.stringify(over)).toContain(path);
    }
    expect(
      (await post(w.t, { ...base(w, { customHeader: 'x'.repeat(150) }), contactIds: ids })).status,
    ).toBe(201);
  });

  it('keeps what a mail uses and clears what it does not, on create and on edit', async () => {
    const w = await workspace('clear');
    const ids = await api().seedContacts(w.t, [{ name: 'A', email: 'a@buyer.test' }]);
    const res = await post(w.t, {
      ...base(w, {
        status: 'draft',
        customFooter: 'Bye',
        customButtons: [{ type: 'url', text: 'Go', value: 'https://x.test' }],
        throttleMinSec: 5,
        throttleMaxSec: 9,
        batchSize: 10,
        dailyLimit: 20,
        windowStart: '09:00',
        windowEnd: '18:00',
        trackingEnabled: true,
      }),
      contactIds: ids,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = Number(
      (await q(`SELECT id FROM wpcampaigns WHERE uuid = $1`, [res.body.campaign.id]))[0]!.id,
    );
    const stored = (
      await q(
        `SELECT custom_footer, custom_buttons, throttle_min_sec, throttle_max_sec, batch_size, daily_limit, window_start, window_end, tracking_enabled
           FROM wpcampaigns WHERE id = $1`,
        [id],
      )
    )[0]!;
    expect(stored).toMatchObject({
      custom_footer: null,
      throttle_min_sec: null,
      batch_size: null,
      daily_limit: null,
      window_start: null,
      tracking_enabled: false,
    });
    expect(stored.custom_buttons).toEqual([]);

    const edit = await api()
      .http()
      .put(`/v2/campaigns/${res.body.campaign.id}`)
      .set(bearer(w.t.admin))
      .send({ ...base(w, { status: 'draft', dailyLimit: 50, customHeader: 'New subject' }) });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect((await q(`SELECT daily_limit FROM wpcampaigns WHERE id = $1`, [id]))[0]).toMatchObject({
      daily_limit: null,
    });
    const bad = await api()
      .http()
      .put(`/v2/campaigns/${res.body.campaign.id}`)
      .set(bearer(w.t.admin))
      .send({ ...base(w, { status: 'draft', abTesting: true }) });
    expect(bad.status).toBe(422);
  });

  it('needs the Email add-on in the plan, and a connected mailbox of the workspace', async () => {
    const w = await workspace('plan');
    const ids = await api().seedContacts(w.t, [{ name: 'A', email: 'a@buyer.test' }]);
    // A mailbox key that is not in this workspace is refused like any number that is not connected.
    const stranger = await post(w.t, {
      ...base(w),
      senderKey: `email:${randomUUID()}`,
      contactIds: ids,
    });
    expect(stranger.status).toBe(422);
    expect(JSON.stringify(stranger.body)).toContain('senderKey');

    await setMailPlan(rig.p, w.t.orgId, { feature: false });
    const res = await post(w.t, { ...base(w), contactIds: ids });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code ?? res.body.error?.code).toBe('PLAN_FEATURE_LOCKED');
    await setMailPlan(rig.p, w.t.orgId, { feature: true });
  });

  it('a template broadcast cannot be sent from a mailbox', async () => {
    const w = await workspace('bcast');
    const ids = await api().seedContacts(w.t, [{ name: 'A', email: 'a@buyer.test' }]);
    const tpl = (
      await q(
        `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status)
         VALUES ($1, 't1', 'Hello', 'standard', 'approved') RETURNING uuid`,
        [w.t.orgId],
      )
    )[0]!.uuid as string;
    const res = await api()
      .http()
      .post('/v2/broadcasts')
      .set(bearer(w.t.admin))
      .set('idempotency-key', randomUUID())
      .send({
        name: 'B',
        templateId: tpl,
        contactIds: ids,
        senderKeys: [`email:${w.mailbox}`],
        scheduleType: 'now',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(JSON.stringify(res.body)).toContain('senderKeys');
  });
});

describe('the builder lists mailboxes as senders', () => {
  const builder = (t: Tenant, channel?: string) =>
    api()
      .http()
      .get(`/v2/campaigns/builder${channel ? `?channel=${channel}` : ''}`)
      .set(bearer(t.admin));

  it('?channel=email lists the connected mailboxes, no templates; the WhatsApp builder never lists one', async () => {
    const w = await workspace('bld');
    const res = await builder(w.t, 'email');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.templates).toEqual([]);
    expect(res.body.senders).toEqual([
      {
        key: `email:${w.mailbox}`,
        label: expect.any(String),
        phone: w.address,
        engine: 'email',
        engineLabel: 'Email',
        isDefault: true,
      },
    ]);
    const wa = await builder(w.t);
    expect(wa.status).toBe(200);
    expect(JSON.stringify(wa.body.senders)).not.toContain('email:');
  });

  it('says why a mailbox is not offered, and lists nothing without the plan add-on', async () => {
    const w = await workspace('hid');
    await q(`UPDATE mail_mailboxes SET status = 'needs_reauth' WHERE uuid = $1`, [w.mailbox]);
    let res = await builder(w.t, 'email');
    expect(res.body.senders).toEqual([]);
    expect(res.body.hidden).toEqual([{ engine: 'email', reason: 'error', count: 1 }]);
    await q(`UPDATE mail_mailboxes SET status = 'connected' WHERE uuid = $1`, [w.mailbox]);
    await setMailPlan(rig.p, w.t.orgId, { feature: false });
    res = await builder(w.t, 'email');
    expect(res.body.senders).toEqual([]);
    expect(res.body.hidden).toEqual([]);
    await setMailPlan(rig.p, w.t.orgId, { feature: true });
  });

  it('a personal mailbox is its owner’s alone: nobody else can pick it as a campaign sender', async () => {
    const w = await workspace('pers');
    const owner = Number(
      (await q(`SELECT id FROM users WHERE org_id = $1 ORDER BY id LIMIT 1`, [w.t.orgId]))[0]!.id,
    );
    const stranger = owner + 987_654;
    await q(`UPDATE mail_mailboxes SET scope = 'personal', owner_user_id = $2 WHERE uuid = $1`, [
      w.mailbox,
      owner,
    ]);
    const directory = rig.p.h.app.get<SenderDirectory>(SENDER_DIRECTORY as never, {
      strict: false,
    });
    const db = rig.p.h.app.get(DatabaseService, { strict: false });
    const resolveAs = (userId: number | null) =>
      RequestContextStore.run(
        { requestId: 'r', orgId: w.t.orgId, actorType: 'user', actorId: userId, userId },
        () =>
          db.txAs({ orgId: w.t.orgId }, (tx) =>
            directory.resolve(tx, w.t.orgId, [`email:${w.mailbox}`]),
          ),
      );
    // The owner (the workspace admin here) is offered it; another person, and a caller with no person behind it, are not.
    expect((await builder(w.t, 'email')).body.senders).toHaveLength(1);
    expect((await resolveAs(owner)).map((s) => s.engine)).toEqual(['email']);
    expect(await resolveAs(stranger)).toEqual([]);
    expect(await resolveAs(null)).toEqual([]);
    // Once it is not the owner's any more, the owner's list is empty too.
    await q(`UPDATE mail_mailboxes SET owner_user_id = NULL, scope = 'shared' WHERE uuid = $1`, [
      w.mailbox,
    ]);
    expect((await resolveAs(stranger)).map((s) => s.engine)).toEqual(['email']);
  });
});

describe('limits, the plan and what stops a run', () => {
  const cap = (w: Rig, limit: number) =>
    q(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      w.t.orgId,
      JSON.stringify({
        features: { email_channel: true },
        limits: { email_mailboxes: 3, email_monthly: limit },
      }),
    ]);

  it('the plan’s monthly email cap: a run that starts over it fails whole, one that reaches it mid-run stops sending', async () => {
    const w = await workspace('cap');
    await cap(w, 2);
    const c = await campaign(w, [
      { name: 'P1', email: 'p1@buyer.test' },
      { name: 'P2', email: 'p2@buyer.test' },
      { name: 'P3', email: 'p3@buyer.test' },
    ]);
    await run(w, c.id);
    const r = await rows(c.id);
    expect(r.filter((x) => x.status === 'sent')).toHaveLength(2);
    const over = r.find((x) => x.status === 'failed')!;
    expect(over.error_message).toBe(
      "You've reached your plan's limit of 2 emails a month. Upgrade your plan to send more.",
    );

    // The month is spent: the next campaign fails up front with the plan sentence and sends nothing.
    const next = await campaign(w, [{ name: 'P4', email: 'p4@buyer.test' }]);
    expect(await run(w, next.id)).toBe('failed');
    expect(await camp(next.id)).toMatchObject({ status: 'failed', sent_count: 0 });
    expect(rig.fake.sentTo(w.address).some((m) => /p4@buyer/i.test(headers(m.raw)))).toBe(false);
    // 0 is unlimited.
    await cap(w, 0);
    await q(`UPDATE wpcampaigns SET status = 'running' WHERE id = $1`, [next.id]);
    expect(await run(w, next.id)).toBe('finished');
  });

  it('the mailbox’s hourly cap spreads the campaign over the hours: the run stops, the rest waits, and sends later', async () => {
    const w = await workspace('hour');
    await q(`UPDATE mail_mailboxes SET send_limit_per_hour = 2 WHERE uuid = $1`, [w.mailbox]);
    const c = await campaign(w, [
      { name: 'H1', email: 'h1@buyer.test' },
      { name: 'H2', email: 'h2@buyer.test' },
      { name: 'H3', email: 'h3@buyer.test' },
      { name: 'H4', email: 'h4@buyer.test' },
    ]);
    expect(await run(w, c.id)).toBe('rearmed');
    const first = await rows(c.id);
    expect(first.filter((r) => r.status === 'sent')).toHaveLength(2);
    // Nobody failed: the rest is queued and the campaign is scheduled again after a slot frees.
    expect(first.filter((r) => r.status === 'queued')).toHaveLength(2);
    expect(await camp(c.id)).toMatchObject({
      status: 'scheduled',
      schedule_type: 'scheduled',
      failed_count: 0,
    });

    // An hour later (the window is cleared here) the sweeper starts it again and the rest goes out.
    await redis.del(limits.hourlyKey(w.t.orgId, w.mailbox));
    await q(`UPDATE wpcampaigns SET status = 'running' WHERE id = $1`, [c.id]);
    expect(await run(w, c.id)).toBe('finished');
    expect((await rows(c.id)).every((r) => r.status === 'sent')).toBe(true);
  });

  it('Cancel mid-run stops it at once and the status stays the operator’s', async () => {
    const w = await workspace('cancel');
    const c = await campaign(w, [
      { name: 'C1', email: 'c1@buyer.test' },
      { name: 'C2', email: 'c2@buyer.test' },
      { name: 'C3', email: 'c3@buyer.test' },
    ]);
    const real = registry.get('email')!;
    let sentCount = 0;
    const wrapper: EngineSender = {
      open: async (orgId, sender) => {
        const opened = await real.open(orgId, sender);
        return {
          ...opened,
          sendText: async (m) => {
            const out = await opened.sendText!(m);
            if (++sentCount === 1)
              await q(`UPDATE wpcampaigns SET status = 'cancelled' WHERE id = $1`, [c.id]);
            return out;
          },
        };
      },
    };
    registry.register('email', wrapper);
    cleanups.push(() => registry.register('email', real));
    expect(await run(w, c.id)).toBe('halted');
    const r = await rows(c.id);
    expect(r.filter((x) => x.status === 'sent')).toHaveLength(1);
    expect(r.filter((x) => x.status === 'queued')).toHaveLength(2);
    expect((await camp(c.id)).status).toBe('cancelled');
  });

  it('a campaign past its auto-end date sends nothing and ends', async () => {
    const w = await workspace('end');
    const c = await campaign(w, [{ name: 'E1', email: 'e1@buyer.test' }]);
    await q(`UPDATE wpcampaigns SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      c.id,
    ]);
    expect(await run(w, c.id)).toBe('expired');
    expect(rig.fake.sentTo(w.address).some((m) => /e1@buyer/i.test(headers(m.raw)))).toBe(false);
    expect((await rows(c.id))[0]!.status).toBe('failed');
  });

  it('two runs at once never mail anyone twice: the campaign has one lock', async () => {
    const w = await workspace('lock');
    const c = await campaign(w, [
      { name: 'L1', email: 'l1@buyer.test' },
      { name: 'L2', email: 'l2@buyer.test' },
    ]);
    const results = await Promise.all([run(w, c.id), run(w, c.id)]);
    expect([...results].sort()).toContain('finished');
    const mails = rig.fake.sentTo(w.address).filter((m) => /l[12]@buyer/i.test(headers(m.raw)));
    expect(mails).toHaveLength(2);
  });

  it('a mailbox that was disconnected after launch fails the run and sends nothing', async () => {
    const w = await workspace('gone');
    const c = await campaign(w, [{ name: 'G1', email: 'g1@buyer.test' }]);
    await q(`UPDATE mail_mailboxes SET status = 'disconnected' WHERE uuid = $1`, [w.mailbox]);
    expect(await run(w, c.id)).toBe('failed');
    expect(rig.fake.sentTo(w.address).some((m) => /g1@buyer/i.test(headers(m.raw)))).toBe(false);
  });

  it('a workspace whose plan lost the add-on fails the run before any mail', async () => {
    const w = await workspace('lost');
    const c = await campaign(w, [{ name: 'X1', email: 'x1@buyer.test' }]);
    await setMailPlan(rig.p, w.t.orgId, { feature: false });
    expect(await run(w, c.id)).toBe('failed');
    expect(rig.fake.sentTo(w.address).some((m) => /x1@buyer/i.test(headers(m.raw)))).toBe(false);
  });

  it('the wallet is never asked: no launch check and no per-mail charge (a WhatsApp campaign is checked)', async () => {
    const w = await workspace('wallet');
    const get = <T>(token: unknown) => rig.p.h.app.get<T>(token as never, { strict: false });
    const wallet = get<{ precheck: (...a: unknown[]) => Promise<void> }>(WALLET_GATE);
    const billing = get<{ consume: (...a: unknown[]) => Promise<boolean> }>(CAMPAIGN_BILLING);
    const precheck = vi.spyOn(wallet, 'precheck');
    const consume = vi.spyOn(billing, 'consume');
    try {
      // The control: a WhatsApp campaign asks the wallet at launch.
      const ids = await api().seedContacts(w.t, [{ name: 'W0', phone: '+919700099999' }]);
      const device = (
        await q(
          `INSERT INTO devices (org_id, device_name, phone_number, status, active)
           VALUES ($1, 'Phone', '+919700088888', 'connected', true) RETURNING uuid`,
          [w.t.orgId],
        )
      )[0]!.uuid as string;
      const wa = await post(w.t, {
        name: 'WA',
        type: 'text',
        customMessage: 'Hi',
        scheduleType: 'now',
        senderKey: `baileys:${device}`,
        contactIds: ids,
      });
      expect(wa.status, JSON.stringify(wa.body)).toBe(201);
      expect(precheck).toHaveBeenCalledTimes(1);

      // An email campaign asks it neither at launch nor for any of its mails.
      const c = await campaign(w, [{ name: 'W1', email: 'w1@buyer.test' }]);
      expect(await run(w, c.id)).toBe('finished');
      expect(await camp(c.id)).toMatchObject({ status: 'completed', sent_count: 1 });
      expect(precheck).toHaveBeenCalledTimes(1);
      expect(consume).not.toHaveBeenCalled();
    } finally {
      precheck.mockRestore();
      consume.mockRestore();
    }
  });
});
