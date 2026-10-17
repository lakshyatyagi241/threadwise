import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QUEUES } from '../../../src/infra/queue/queues';
import { SendWindowService } from '../../../src/modules/compliance-center';
import { ConsentGate } from '../../../src/modules/contact-consent';
import { ConsentKit, refusedWith } from '../contact-consent/broadcast-consent.support';
import { LineBroadcastSenderService } from '../../../src/modules/channel-line/line-broadcast-sender.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { FakeLine, connectChannel, delivery, deliver, textEvent, userId } from './support';

/**
 * Quiet hours on the LINE broadcast (BL-191): a person whose local time is inside the workspace's quiet hours is HELD, not denied. They stay
 * `pending` with the instant they may be messaged, the rest of the audience goes, a delayed job comes back at the first opening, and on
 * release the ConsentGate is asked again. The five social broadcasts share the helper this exercises (compliance-center/held-recipients);
 * this is the one that runs it against a real Postgres and Redis.
 */
let h: Harness;
let api: Api;
let sender: LineBroadcastSenderService;
let window: SendWindowService;
const fake = new FakeLine();

/**
 * 2030-10-15 16:00 UTC: 21:30 in India (quiet 21:00 to 09:00), 12:00 in New York (open). A date well ahead of the database clock, which
 * the claim reads: the hold must keep a recipient out of the claim until the real hour, as it does in production.
 */
const EVENING = new Date('2030-10-15T16:00:00Z');
/** A minute past the end of the quiet hours in India (09:00 IST = 03:30 UTC). */
const MORNING = new Date('2030-10-16T03:31:00Z');
const OPENS = '2030-10-16T03:30:00.000Z';

/** Time passes: the held people's hour is past on the database clock too (the app clock is moved by the test). */
const hoursPass = (uuid: string) =>
  h.owner.query(
    `UPDATE line_broadcast_recipients r SET held_until = now() - interval '1 minute'
       FROM line_broadcasts b WHERE b.org_id = r.org_id AND b.id = r.line_broadcast_id AND b.uuid = $1 AND r.held_until IS NOT NULL`,
    [uuid],
  );

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  fake.install(h);
  sender = h.app.get(LineBroadcastSenderService);
  sender.sleep = () => Promise.resolve();
  window = h.app.get(SendWindowService);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  fake.reset();
  window.now = () => EVENING;
});

async function arrange(label: string, zones: Array<string | null>, quietHours = true) {
  const t = await api.signup(label);
  const c = await connectChannel(h, api, fake, t);
  for (let i = 1; i <= zones.length; i++) {
    await deliver(api, c, delivery(textEvent(userId(i), `hi from ${i}`)));
  }
  fake.reset();
  for (const [i, zone] of zones.entries()) {
    if (zone)
      await h.owner.query(
        `UPDATE contacts SET data = jsonb_build_object('timezone', $3::text) WHERE org_id = $1 AND channel_uid = $2`,
        [t.orgId, userId(i + 1), zone],
      );
  }
  if (quietHours) {
    await h.owner.query(
      `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end) VALUES ($1, true, '21:00', '09:00')`,
      [t.orgId],
    );
  }
  return { t, c };
}

const post = (t: Tenant, path: string, body?: object) =>
  api
    .http()
    .post(`/v2/line/${path}`)
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body ?? {});

async function started(t: Tenant, c: { uuid: string }, count: number) {
  const made = await post(t, 'broadcasts', {
    name: 'Promo',
    channelId: c.uuid,
    body: 'Hi {{name}}',
    userIds: Array.from({ length: count }, (_, i) => userId(i + 1)),
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  await post(t, `broadcasts/${made.body.id}/start`);
  const row = (
    await h.owner.query(`SELECT id FROM line_broadcasts WHERE uuid = $1`, [made.body.id])
  ).rows[0];
  return { uuid: made.body.id as string, id: Number(row.id) };
}

const recipients = async (uuid: string) =>
  (
    await h.owner.query(
      `SELECT r.line_user_id, r.status, r.error, r.held_until, r.held_reason FROM line_broadcast_recipients r
         JOIN line_broadcasts b ON b.org_id = r.org_id AND b.id = r.line_broadcast_id
        WHERE b.uuid = $1 ORDER BY r.id`,
      [uuid],
    )
  ).rows as Array<{
    line_user_id: string;
    status: string;
    error: string | null;
    held_until: Date | null;
    held_reason: string | null;
  }>;
const broadcast = async (uuid: string) =>
  (
    await h.owner.query(
      `SELECT status, sent, failed, blocked FROM line_broadcasts WHERE uuid = $1`,
      [uuid],
    )
  ).rows[0];
const pushed = () => fake.of('push').map((c) => c.args[0] as string);

describe('BL-191: a LINE broadcast is held, not denied, in the quiet hours', () => {
  it('sends whoever is awake, holds whoever is in their quiet hours, and comes back at the opening', async () => {
    const { t, c } = await arrange('lqh1', ['Asia/Kolkata', 'America/New_York', null]);
    const b = await started(t, c, 3);

    expect(await sender.run(t.orgId, b.id)).toBe('held');
    expect(pushed()).toEqual([userId(2), userId(3)]);
    const rows = await recipients(b.uuid);
    expect(rows[0]).toMatchObject({
      line_user_id: userId(1),
      status: 'pending',
      held_reason: 'quiet_hours',
    });
    expect(rows[0]!.held_until!.toISOString()).toBe(OPENS);
    expect(rows.slice(1).map((r) => r.status)).toEqual(['sent', 'sent']);
    // Still sending: the broadcast is not done while somebody waits.
    expect(await broadcast(b.uuid)).toMatchObject({ status: 'sending', sent: 2 });

    // The list says how many wait and until when.
    const list = await api.http().get('/v2/line/broadcasts').set(bearer(t.admin));
    const mine = list.body.data.find((x: { id: string }) => x.id === b.uuid);
    expect(mine).toMatchObject({ held: 1, heldUntil: OPENS, status: 'sending' });

    // A delayed job waits for the opening, named by the broadcast and the opening.
    const queue = h.app.get<Queue>(getQueueToken(QUEUES.LINE_BROADCAST));
    const job = (await queue.getDelayed()).find((j) => j.data.broadcastId === b.id);
    expect(job, 'the wake-up job').toBeDefined();
    expect(job!.id).toBe(`${b.uuid}-held-${Math.floor(Date.parse(OPENS) / 1000)}`);
    expect(job!.opts.delay).toBeGreaterThan(11 * 3_600_000);

    // Asked again before the hours open: nothing more goes, and it still waits.
    fake.reset();
    expect(await sender.run(t.orgId, b.id)).toBe('held');
    expect(pushed()).toEqual([]);

    // The hours open: the held person is messaged and the broadcast ends.
    window.now = () => MORNING;
    await hoursPass(b.uuid);
    expect(await sender.run(t.orgId, b.id)).toBe('done');
    expect(pushed()).toEqual([userId(1)]);
    const after = await recipients(b.uuid);
    expect(after.map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);
    expect(after.every((r) => r.held_until === null && r.held_reason === null)).toBe(true);
    expect(await broadcast(b.uuid)).toMatchObject({ status: 'done', sent: 3 });
  });

  it('a person who unsubscribed while the message waited is not messaged on release', async () => {
    const { t, c } = await arrange('lqh2', ['Asia/Kolkata', 'America/New_York']);
    const b = await started(t, c, 2);
    expect(await sender.run(t.orgId, b.id)).toBe('held');

    await h.owner.query(
      `UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1 AND channel_uid = $2`,
      [t.orgId, userId(1)],
    );
    window.now = () => MORNING;
    await hoursPass(b.uuid);
    expect(await sender.run(t.orgId, b.id)).toBe('done');
    const rows = await recipients(b.uuid);
    expect(rows[0]).toMatchObject({ status: 'blocked' });
    expect(rows[0]!.error).toMatch(/consent/);
    expect(pushed()).toEqual([userId(2)]);
  });

  it('with the quiet hours off (the default) nobody is held', async () => {
    const { t, c } = await arrange('lqh3', ['Asia/Kolkata'], false);
    const b = await started(t, c, 1);
    expect(await sender.run(t.orgId, b.id)).toBe('done');
    expect(pushed()).toEqual([userId(1)]);
  });

  it('pausing a held broadcast stops the wake-up from sending', async () => {
    const { t, c } = await arrange('lqh4', ['Asia/Kolkata', 'America/New_York']);
    const b = await started(t, c, 2);
    expect(await sender.run(t.orgId, b.id)).toBe('held');
    await post(t, `broadcasts/${b.uuid}/pause`);
    window.now = () => MORNING;
    fake.reset();
    expect(await sender.run(t.orgId, b.id)).toBe('skipped');
    expect(pushed()).toEqual([]);
    expect((await recipients(b.uuid))[0]).toMatchObject({ status: 'pending' });
  });
});

describe('BL-141: every LINE batch asks the ConsentGate, on the first send as on a release', () => {
  const kit = () => new ConsentKit(h, api);
  const contactOf = async (t: Tenant, n: number) =>
    (await kit().contact(t, 'line', userId(n))) as { id: number; uuid: string };
  const byUser = (rows: Awaited<ReturnType<typeof recipients>>) =>
    Object.fromEntries(rows.map((r) => [r.line_user_id, r]));

  it('an opted-out person is not messaged and keeps the gate reason; a withdrawn ledger, a granted one and a plain one behave', async () => {
    const { t, c } = await arrange('lcg1', [null, null, null, null], false);
    await kit().unsubscribe(t, (await contactOf(t, 1)).id);
    await kit().record(t, (await contactOf(t, 2)).uuid, 'line', 'withdrawn');
    await kit().record(t, (await contactOf(t, 3)).uuid, 'line', 'granted');
    const b = await started(t, c, 4);

    expect(await sender.run(t.orgId, b.id)).toBe('done');

    expect(pushed()).toEqual([userId(3), userId(4)]);
    const rows = byUser(await recipients(b.uuid));
    expect(rows[userId(1)]).toMatchObject({ status: 'blocked', error: refusedWith('withdrawn') });
    expect(rows[userId(2)]).toMatchObject({ status: 'blocked', error: refusedWith('withdrawn') });
    expect(rows[userId(3)]).toMatchObject({ status: 'sent', error: null });
    expect(rows[userId(4)]).toMatchObject({ status: 'sent', error: null });
    expect(await broadcast(b.uuid)).toMatchObject({ status: 'done', sent: 2, blocked: 2 });
  });

  it('with the workspace switch on a person needs a recorded grant; one with no contact has none', async () => {
    const { t, c } = await arrange('lcg2', [null, null, null], false);
    await kit().record(t, (await contactOf(t, 1)).uuid, 'line', 'granted');
    const orphan = await contactOf(t, 3);
    await h.owner.query(
      `UPDATE conversations SET contact_id = NULL WHERE org_id = $1 AND contact_id = $2`,
      [t.orgId, orphan.id],
    );
    await kit().setSwitch(t, true);
    const b = await started(t, c, 3);

    await sender.run(t.orgId, b.id);

    expect(pushed()).toEqual([userId(1)]);
    const rows = byUser(await recipients(b.uuid));
    for (const n of [2, 3]) {
      expect(rows[userId(n)]).toMatchObject({
        status: 'blocked',
        error: refusedWith('no_consent_recorded'),
      });
    }
  });

  it('with the switch off (the default) a person with no grant is messaged', async () => {
    const { t, c } = await arrange('lcg3', [null, null], false);
    const b = await started(t, c, 2);
    await sender.run(t.orgId, b.id);
    expect(pushed()).toEqual([userId(1), userId(2)]);
  });

  it('a contact flagged as a minor is skipped when the workspace says no minors', async () => {
    const { t, c } = await arrange('lcg4', [null, null], false);
    await kit().minor(t, (await contactOf(t, 1)).id);
    const b = await started(t, c, 2);
    await sender.run(t.orgId, b.id);
    expect(pushed()).toEqual([userId(2)]);
    expect(byUser(await recipients(b.uuid))[userId(1)]).toMatchObject({
      status: 'blocked',
      error: refusedWith('subject_minor'),
    });
  });

  it('a service message is never blocked: STOP, the switch and a minor flag do not stop a reply or a utility notice', async () => {
    const { t } = await arrange('lcg5', [null], false);
    const person = await contactOf(t, 1);
    await kit().unsubscribe(t, person.id);
    await kit().minor(t, person.id);
    await kit().setSwitch(t, true);
    const gate = h.app.get(ConsentGate);
    const subject = { type: 'contact', id: person.id } as const;
    expect((await gate.check(t.orgId, subject, 'line', 'marketing_messaging')).decision).toBe(
      'deny',
    );
    expect(
      await gate.check(t.orgId, subject, 'line', 'service_messaging', undefined, {
        replyWindowOpen: true,
      }),
    ).toEqual({ decision: 'allow', reason: 'inbound_reply_window' });
    expect(await gate.check(t.orgId, subject, 'line', 'service_messaging')).toEqual({
      decision: 'allow',
      reason: 'utility_exempt',
    });
  });
});
