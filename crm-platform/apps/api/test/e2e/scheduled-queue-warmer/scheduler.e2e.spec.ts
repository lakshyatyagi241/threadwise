import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { QUEUES } from '../../../src/infra/queue/queues';
import {
  CapTally,
  PACING_SETTINGS,
  PacingRuntime,
  SenderLease,
  type PacingSettingsSource,
} from '../../../src/modules/broadcasts';
import { MergeTagService } from '../../../src/modules/crm';
import {
  OutboundRegistry,
  SenderResolver,
  type EngineTransport,
  type SendCommand,
} from '../../../src/modules/node-bridge-runtime';
import { ScheduledDueService } from '../../../src/modules/scheduled-queue-warmer/scheduled-due.service';
import { WarmerService } from '../../../src/modules/scheduled-queue-warmer';
import { ScheduledRunService } from '../../../src/modules/scheduled-queue-warmer/scheduled-run.service';
import { SchedulerService } from '../../../src/modules/scheduled-queue-warmer';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * The scheduled-messages engine (TW-NODE-030 to 036, 031 to 033 and 035 in particular): the real app and a real Postgres and
 * Redis, with a fake engine transport standing in for the provider.
 */
let h: Harness;
let api: Api;
let registry: OutboundRegistry;
let runService: ScheduledRunService;
let dueService: ScheduledDueService;
let scheduler: SchedulerService;
let queue: Queue;
let runtime: PacingRuntime;
let pacing: PacingSettingsSource;
let cap: CapTally;

let sent: Array<{ command: SendCommand; reference: string }> = [];
let behaviour: (n: number) => string | Error = (n) => `wamid.${n}`;
let afterSend: (n: number) => Promise<void> = async () => undefined;

const fake: EngineTransport = {
  open: () =>
    Promise.resolve({
      send: async (command, ctx) => {
        sent.push({ command, reference: ctx.clientReference });
        const n = sent.length;
        const out = behaviour(n);
        await afterSend(n);
        if (out instanceof Error) throw out;
        return { providerMessageId: out };
      },
    }),
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  registry = h.app.get(OutboundRegistry);
  runtime = h.app.get(PacingRuntime);
  runtime.sleep = () => Promise.resolve(); // the gaps themselves are checked with the broadcast sender
  pacing = h.app.get<PacingSettingsSource>(PACING_SETTINGS);
  cap = h.app.get(CapTally);
  scheduler = h.app.get(SchedulerService);
  queue = h.app.get<Queue>(getQueueToken(QUEUES.SCHED_RUN), { strict: false });
  const db = h.app.get(DatabaseService);
  runService = new ScheduledRunService(
    db,
    h.app.get(SenderResolver),
    registry,
    h.app.get(MergeTagService, { strict: false }),
    pacing as never,
    runtime,
    cap,
    h.app.get(SenderLease),
    h.app.get(WarmerService),
  );
  dueService = new ScheduledDueService(db, queue as never);
}, 240_000);

afterAll(async () => {
  await queue?.obliterate({ force: true }).catch(() => undefined);
  await h?.stop();
});

beforeEach(() => {
  sent = [];
  behaviour = (n) => `wamid.${n}`;
  afterSend = async () => undefined;
  registry.register('baileys', fake);
  pacing.get = () =>
    Promise.resolve({
      msgGapSeconds: 3,
      enableBatches: false,
      batchSize: 50,
      batchGapMinutes: 5,
      baileysDailyCap: 4000,
    });
});

let counter = 0;
async function arrange(label: string, o: { device?: boolean } = {}) {
  const t = await api.signup(label);
  if (o.device !== false) {
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
       VALUES ($1, 'Main', '+91', '9811100001', 'connected', true)`,
      [t.orgId],
    );
  }
  return t;
}

interface Over {
  scheduled_time?: string;
  next_run_at?: string | null;
  schedule_type?: 'once' | 'recurring';
  repeat_interval?: string | null;
  repeat_every?: number;
  days_of_week?: string | null;
  end_date?: string | null;
  timezone?: string;
  template_type?: string;
  message_content?: string;
  status?: string;
  provider?: string | null;
}
async function schedule(t: Tenant, recipients: number, o: Over = {}): Promise<number> {
  const col = (k: keyof Over, d: unknown) => (k in o ? o[k] : d);
  const r = await h.owner.query(
    `INSERT INTO scheduled_messages (org_id, schedule_name, template_type, message_content, schedule_type, send_date, send_time,
        scheduled_time, next_run_at, timezone, repeat_interval, repeat_every, days_of_week, end_date, recipient_type,
        total_recipients, provider, status)
     VALUES ($1, 'Test', $2, $3, $4, '2026-10-05', '09:00', $5::timestamptz, $6::timestamptz, $7, $8, $9, $10::jsonb, $11, 'numbers', $12, $13, $14)
     RETURNING id`,
    [
      t.orgId,
      col('template_type', 'text'),
      col('message_content', 'Hello'),
      col('schedule_type', 'once'),
      col('scheduled_time', new Date(Date.now() - 60_000).toISOString()),
      col('next_run_at', null),
      col('timezone', 'UTC'),
      col('repeat_interval', null),
      col('repeat_every', 1),
      col('days_of_week', null),
      col('end_date', null),
      recipients,
      col('provider', 'baileys'),
      col('status', 'scheduled'),
    ],
  );
  const id = Number(r.rows[0].id);
  for (let i = 0; i < recipients; i++) {
    await h.owner.query(
      `INSERT INTO scheduled_message_contacts (org_id, scheduled_message_id, phone) VALUES ($1, $2, $3)`,
      [t.orgId, id, `+91982${String(counter++).padStart(7, '0')}`],
    );
  }
  return id;
}

const run = (t: Tenant, id: number) =>
  RequestContextStore.run(
    { requestId: `t-${id}`, orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
    () => runService.run(t.orgId, id),
  );
const inContext = <T>(t: Tenant, fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 't', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
    fn,
  );

const row = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, total_sent, total_failed, failure_reason, next_run_at, last_run_at, completed_at, failed_at,
              next_attempt_at, node_schedule_id, send_attempts
         FROM scheduled_messages WHERE id = $1`,
      [id],
    )
  ).rows[0];
const contacts = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, error_message, wa_message_id, sent_at FROM scheduled_message_contacts
        WHERE scheduled_message_id = $1 ORDER BY id`,
      [id],
    )
  ).rows;

describe('a one-off run (TW-NODE-031)', () => {
  it('sends to every recipient, records each one, and completes', async () => {
    const t = await arrange('oneoff');
    const id = await schedule(t, 3);
    expect(await run(t, id)).toBe('finished');
    expect(sent.map((s) => s.command)).toEqual([
      expect.objectContaining({ type: 'text', body: 'Hello' }),
      expect.objectContaining({ type: 'text' }),
      expect.objectContaining({ type: 'text' }),
    ]);
    expect(sent[0]!.reference).toMatch(new RegExp(`^sched-${id}-\\d+$`));
    const rows = await contacts(id);
    expect(rows.map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);
    expect(rows.map((r) => r.wa_message_id)).toEqual(['wamid.1', 'wamid.2', 'wamid.3']);
    expect(rows.every((r) => r.sent_at)).toBe(true);
    expect(await row(id)).toMatchObject({ status: 'completed', total_sent: 3, total_failed: 0 });
    expect((await row(id)).completed_at).not.toBeNull();
  });

  it('a failing recipient is failed on its own and the schedule still completes', async () => {
    const t = await arrange('partial');
    const id = await schedule(t, 3);
    behaviour = (n) => (n === 2 ? new Error('Number is not on WhatsApp') : `wamid.${n}`);
    await run(t, id);
    expect((await contacts(id)).map((r) => r.status)).toEqual(['sent', 'failed', 'sent']);
    expect((await contacts(id))[1]!.error_message).toBe('Number is not on WhatsApp');
    expect(await row(id)).toMatchObject({ status: 'completed', total_sent: 2, total_failed: 1 });
  });

  it('every recipient failing makes the schedule failed', async () => {
    const t = await arrange('allfail');
    const id = await schedule(t, 2);
    behaviour = () => new Error('boom');
    await run(t, id);
    expect(await row(id)).toMatchObject({
      status: 'failed',
      total_sent: 0,
      total_failed: 2,
      failure_reason: 'Every recipient failed',
    });
  });

  it('fails with the Reference reasons when there is no sender or no recipients, and sends nothing', async () => {
    const noDevice = await arrange('nodev', { device: false });
    const a = await schedule(noDevice, 2);
    expect(await run(noDevice, a)).toBe('failed');
    expect(await row(a)).toMatchObject({ status: 'failed', failure_reason: 'Client not found' });

    const t = await arrange('norecip');
    const b = await schedule(t, 0);
    expect(await run(t, b)).toBe('failed');
    expect(await row(b)).toMatchObject({ status: 'failed', failure_reason: 'No recipients' });
    expect(sent).toHaveLength(0);
  });

  it('refuses a message kind it cannot send once, up front, with the reason', async () => {
    const t = await arrange('tpl');
    const id = await schedule(t, 3, { template_type: 'template' });
    await run(t, id);
    expect((await row(id)).failure_reason).toMatch(/template pipeline/);
    expect(sent).toHaveLength(0);
    expect((await contacts(id)).every((r) => r.status === 'pending')).toBe(true);
  });

  it('a schedule that is already finished is skipped', async () => {
    const t = await arrange('done');
    const id = await schedule(t, 1, { status: 'completed' });
    expect(await run(t, id)).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  it('refuses to send a recipient that has no usable number, and moves on', async () => {
    const t = await arrange('nonumber');
    const id = await schedule(t, 2);
    await h.owner.query(
      `UPDATE scheduled_message_contacts SET phone = '--' WHERE id = (SELECT min(id) FROM scheduled_message_contacts WHERE scheduled_message_id = $1)`,
      [id],
    );
    await run(t, id);
    const rows = await contacts(id);
    expect(rows[0]).toMatchObject({ status: 'failed', error_message: 'No usable phone number' });
    expect(rows[1]!.status).toBe('sent');
  });
});

describe('crash safety (Reference sent again after a restart)', () => {
  it('a recipient claimed a moment ago is left alone; one claimed long ago is failed as interrupted, never sent twice', async () => {
    const t = await arrange('claims');
    const id = await schedule(t, 3);
    const ids = (
      await h.owner.query(
        `SELECT id FROM scheduled_message_contacts WHERE scheduled_message_id = $1 ORDER BY id`,
        [id],
      )
    ).rows.map((r) => r.id);
    await h.owner.query(
      `UPDATE scheduled_message_contacts SET status = 'processing' WHERE id = $1`,
      [ids[0]],
    );
    await h.owner.query(
      `UPDATE scheduled_message_contacts SET status = 'processing' WHERE id = $1`,
      [ids[1]],
    );
    // touch_row stamps updated_at on every update, so age the second claim afterwards
    await h.owner.query(
      `ALTER TABLE scheduled_message_contacts DISABLE TRIGGER trg_scheduled_message_contacts_touch`,
    );
    await h.owner.query(
      `UPDATE scheduled_message_contacts SET updated_at = now() - interval '30 minutes' WHERE id = $1`,
      [ids[1]],
    );
    await h.owner.query(
      `ALTER TABLE scheduled_message_contacts ENABLE TRIGGER trg_scheduled_message_contacts_touch`,
    );
    await run(t, id);
    const rows = await contacts(id);
    expect(rows[0]!.status).toBe('processing');
    expect(rows[1]).toMatchObject({
      status: 'failed',
      error_message: 'Send was interrupted before it finished',
    });
    expect(rows[2]!.status).toBe('sent');
    expect(sent).toHaveLength(1);
  });
});

describe('recurring (TW-NODE-032)', () => {
  it('after each run the audience is pending again and the next run is set; totals add up', async () => {
    const t = await arrange('recur');
    const first = new Date('2026-10-05T03:30:00Z');
    const id = await schedule(t, 2, {
      schedule_type: 'recurring',
      repeat_interval: 'daily',
      repeat_every: 2,
      timezone: 'Asia/Kolkata',
      scheduled_time: first.toISOString(),
      next_run_at: first.toISOString(),
    });
    await run(t, id);
    let r = await row(id);
    expect(r.status).toBe('scheduled');
    expect(new Date(r.next_run_at).toISOString()).toBe('2026-10-07T03:30:00.000Z'); // every 2 days, 09:00 in Kolkata
    expect(r.total_sent).toBe(2);
    expect(
      (await contacts(id)).every((c) => c.status === 'pending' && c.wa_message_id === null),
    ).toBe(true);
    await run(t, id);
    r = await row(id);
    expect(r.total_sent).toBe(4);
    expect(sent).toHaveLength(4); // the second run reached everyone again
    expect(new Date(r.next_run_at).toISOString()).toBe('2026-10-09T03:30:00.000Z');
  });

  it('the end date is inclusive: its own run happens, the one after ends the schedule', async () => {
    const t = await arrange('enddate');
    const day1 = new Date('2026-10-05T09:00:00Z');
    const id = await schedule(t, 1, {
      schedule_type: 'recurring',
      repeat_interval: 'daily',
      end_date: '2026-10-06',
      scheduled_time: day1.toISOString(),
      next_run_at: day1.toISOString(),
    });
    await run(t, id); // Oct 5 run, next is Oct 6 (the end date itself)
    expect(new Date((await row(id)).next_run_at).toISOString()).toBe('2026-10-06T09:00:00.000Z');
    expect((await row(id)).status).toBe('scheduled');
    await run(t, id); // Oct 6 run, next would be Oct 7: over
    expect(await row(id)).toMatchObject({ status: 'completed', total_sent: 2 });
  });

  it('an unknown interval ends after its first run instead of failing at registration', async () => {
    const t = await arrange('yearly');
    const id = await schedule(t, 1, { schedule_type: 'recurring', repeat_interval: 'yearly' });
    await run(t, id);
    expect((await row(id)).status).toBe('completed');
  });
});

describe('pausing by the system', () => {
  it('the unofficial engine stops at its daily cap, loses nobody, and resumes after midnight UTC', async () => {
    const t = await arrange('cap');
    const id = await schedule(t, 5);
    pacing.get = () =>
      Promise.resolve({
        msgGapSeconds: 0,
        enableBatches: false,
        batchSize: 50,
        batchGapMinutes: 5,
        baileysDailyCap: 2,
      });
    expect(await run(t, id)).toBe('paused');
    expect(sent).toHaveLength(2);
    const r = await row(id);
    expect(r).toMatchObject({ status: 'paused', total_sent: 2 });
    const resume = new Date(r.next_attempt_at);
    expect(resume.getUTCHours()).toBe(0);
    expect(resume.getTime()).toBeGreaterThan(Date.now());
    expect((await contacts(id)).map((c) => c.status)).toEqual([
      'sent',
      'sent',
      'pending',
      'pending',
      'pending',
    ]);

    // not yet: the poller leaves it; after the resume time it is scheduled again
    expect((await dueService.tickOnce()).resumed).toBe(0);
    await h.owner.query(
      `UPDATE scheduled_messages SET next_attempt_at = now() - interval '1 minute' WHERE id = $1`,
      [id],
    );
    expect((await dueService.tickOnce()).resumed).toBeGreaterThanOrEqual(1);
    expect((await row(id)).status).not.toBe('paused');
  });

  it('the emergency halt puts the recipient back and pauses for a retry, nothing lost', async () => {
    const t = await arrange('halt');
    const id = await schedule(t, 3);
    behaviour = (n) =>
      n === 2 ? new AppError(ERROR_CODES.AUTH_SEND_HALTED, 'Sending is halted', 503) : `wamid.${n}`;
    expect(await run(t, id)).toBe('paused');
    expect((await contacts(id)).map((c) => c.status)).toEqual(['sent', 'pending', 'pending']);
    const r = await row(id);
    expect(r.status).toBe('paused');
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(r.total_sent).toBe(1);
  });
});

describe('stopping a run by hand (TW-NODE-034)', () => {
  it('cancelling mid-run stops before the next batch of sends and leaves the row cancelled', async () => {
    const t = await arrange('cancelmid');
    const id = await schedule(t, 60); // more than one batch of 50
    afterSend = async (n) => {
      if (n === 3) await inContext(t, () => scheduler.cancel(t.orgId, id));
    };
    expect(await run(t, id)).toBe('stopped');
    expect(sent.length).toBeLessThan(60);
    expect((await row(id)).status).toBe('cancelled');
    const states = new Set((await contacts(id)).map((c) => c.status));
    expect(states.has('pending')).toBe(true);
  });

  it('pause, resume, cancel and send-now are quiet no-ops where they do not apply', async () => {
    const t = await arrange('lifecycle');
    const id = await schedule(t, 1, {
      scheduled_time: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await inContext(t, async () => {
      expect(await scheduler.resume(t.orgId, id)).toBe(false); // not paused
      expect(await scheduler.pause(t.orgId, id)).toBe(true);
      expect(await scheduler.pause(t.orgId, id)).toBe(false); // already paused
      expect((await row(id)).status).toBe('paused');
      expect((await row(id)).next_attempt_at).toBeNull(); // by hand: no resume time
      expect(await scheduler.sendNow(t.orgId, id)).toBe(false); // only a waiting schedule
      expect(await scheduler.resume(t.orgId, id)).toBe(true);
      expect((await row(id)).status).toBe('scheduled');
      expect(await scheduler.sendNow(t.orgId, id)).toBe(true);
      expect(new Date((await row(id)).next_run_at).getTime()).toBeLessThanOrEqual(
        Date.now() + 1000,
      );
      expect(await scheduler.cancel(t.orgId, id)).toBe(true);
      expect(await scheduler.cancel(t.orgId, id)).toBe(false);
      expect(await scheduler.pause(t.orgId, id)).toBe(false); // cancelled stays cancelled
    });
    expect((await row(id)).status).toBe('cancelled');
  });

  it('another organization cannot touch it', async () => {
    const a = await arrange('ownerorg');
    const b = await arrange('otherorg');
    const id = await schedule(a, 1);
    await inContext(b, async () => {
      expect(await scheduler.cancel(b.orgId, id)).toBe(false);
      expect(await scheduler.pause(a.orgId, id)).toBe(false); // wrong org id for this context
    });
    expect((await row(id)).status).toBe('scheduled');
  });
});

describe('the due poller (TW-NODE-030, 036)', () => {
  it('queues a due schedule once, marks it running, and leaves a future one alone', async () => {
    const t = await arrange('due');
    const due = await schedule(t, 1);
    const future = await schedule(t, 1, {
      scheduled_time: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const first = await dueService.tickOnce();
    expect(first.queued).toBeGreaterThanOrEqual(1);
    const r = await row(due);
    expect(r.status).toBe('running');
    expect(r.node_schedule_id).toMatch(/^bullmq:/);
    const job = await queue.getJob(r.node_schedule_id.slice('bullmq:'.length));
    expect(job?.data).toEqual({ orgId: t.orgId, scheduledId: due });
    expect((await row(future)).status).toBe('scheduled');
    // a second pass finds nothing new for it
    await dueService.tickOnce();
    expect(await queue.getJobCounts('waiting', 'delayed')).toBeDefined();
    expect((await row(due)).node_schedule_id).toBe(r.node_schedule_id);
  });

  it('a time within 5 seconds, or already past, is due at once; 10 seconds ahead is not', async () => {
    const t = await arrange('fivesec');
    const soon = await schedule(t, 1, {
      scheduled_time: new Date(Date.now() + 3_000).toISOString(),
    });
    const later = await schedule(t, 1, {
      scheduled_time: new Date(Date.now() + 15_000).toISOString(),
    });
    await dueService.tickOnce();
    expect((await row(soon)).status).toBe('running');
    expect((await row(later)).status).toBe('scheduled');
  });

  it('a one-off that missed its time is failed with the reason, not left scheduled for ever', async () => {
    const t = await arrange('missed');
    const id = await schedule(t, 1, {
      scheduled_time: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    });
    const r = await dueService.tickOnce();
    expect(r.missed).toBeGreaterThanOrEqual(1);
    expect(await row(id)).toMatchObject({ status: 'failed' });
    expect((await row(id)).failure_reason).toMatch(/Missed its time/);
    expect(sent).toHaveLength(0);
  });

  it('a recurring schedule that missed runs does not catch up: it moves to its next future occurrence', async () => {
    const t = await arrange('nocatchup');
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000 - 3 * 3_600_000);
    const id = await schedule(t, 1, {
      schedule_type: 'recurring',
      repeat_interval: 'daily',
      scheduled_time: threeDaysAgo.toISOString(),
      next_run_at: threeDaysAgo.toISOString(),
    });
    await dueService.tickOnce();
    const r = await row(id);
    expect(r.status).toBe('scheduled');
    expect(new Date(r.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(sent).toHaveLength(0);
  });

  it('queues a stuck run again under a new attempt (the reconciliation of the old boot sync)', async () => {
    const t = await arrange('stuck');
    const id = await schedule(t, 1);
    await h.owner.query(
      `ALTER TABLE scheduled_messages DISABLE TRIGGER trg_scheduled_messages_touch`,
    );
    await h.owner.query(
      `UPDATE scheduled_messages SET status = 'running', node_schedule_id = 'bullmq:gone-job', updated_at = now() - interval '30 minutes' WHERE id = $1`,
      [id],
    );
    await h.owner.query(
      `ALTER TABLE scheduled_messages ENABLE TRIGGER trg_scheduled_messages_touch`,
    );
    const r = await dueService.tickOnce();
    expect(r.requeued).toBeGreaterThanOrEqual(1);
    const after = await row(id);
    expect(after.send_attempts).toBe(1);
    expect(after.node_schedule_id).not.toBe('bullmq:gone-job');
    // and running it twice for the same recipients still sends once
    await run(t, id);
    await run(t, id);
    expect(sent).toHaveLength(1);
  });
});

describe('one run per number', () => {
  it('a number already in a run is busy: nothing is sent and nothing is lost', async () => {
    const t = await arrange('busy');
    const id = await schedule(t, 2);
    const lease = h.app.get(SenderLease);
    const dev = (await h.owner.query(`SELECT id FROM devices WHERE org_id = $1`, [t.orgId])).rows[0]
      .id;
    const key = SenderLease.key(t.orgId, 'baileys', Number(dev));
    const token = await lease.acquire(key);
    expect(token).not.toBeNull();
    expect(await run(t, id)).toBe('busy');
    expect(sent).toHaveLength(0);
    expect((await contacts(id)).every((c) => c.status === 'pending')).toBe(true);
    await lease.release(key, token!);
    expect(await run(t, id)).toBe('finished');
  });
});
