import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QUEUES } from '../../../src/infra/queue/queues';
import { SendWindowService } from '../../../src/modules/compliance-center';
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
