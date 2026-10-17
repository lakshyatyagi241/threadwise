import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { QUEUES } from '../../../src/infra/queue/queues';
import {
  TEST_SEND_RELEASE_JOB,
  WizardTestSendService,
} from '../../../src/modules/campaigns/wizard/wizard-test-send.service';
import {
  MESSAGE_DELIVERY_EVENT,
  walletDeliveryReportedSchema,
  wizardRetryFailedResponseSchema,
  wizardDeleteResponseSchema,
  wizardTestSendResponseSchema,
  wizardTestLogSchema,
} from '@crm/contracts';
import { MessageBillingService } from '../../../src/modules/wallet-message-billing';
import { MISFIRE_GRACE_MS } from '../../../src/modules/campaigns/wizard/wizard-series.service';
import {
  bearer,
  balanceMinor,
  buildLab,
  group,
  idOfCampaign,
  makeDraft,
  number,
  payPerMessage,
  people,
  problem,
  readyDraft,
  startHarness,
  wiz,
  world,
  type Lab,
  type World,
} from './broadcast-wizard.support';

/**
 * What the worker does for the wizard, against a real Postgres: the planner of a recurring series (the right sequence of runs, the end
 * of the rule, daylight saving, month ends, an outage, a refused run, two workers at once), the frequency-cap retries (only error
 * 131049, exactly 24 hours apart, until the end date, never twice, never charged twice) and the test send (logged and charged the way
 * a normal send is). WhatsApp is the sandbox sender; the clock is ours.
 */
let lab: Lab;

beforeAll(async () => {
  lab = buildLab(await startHarness());
}, 240_000);

afterAll(async () => {
  await lab?.h.stop();
});

const owner = () => lab.h.owner;
// The planner and the retry job scan every tenant, and these specs share one database: each test starts with the others' work switched off.
beforeEach(async () => {
  await owner().query(`UPDATE camp_series SET status = 'cancelled' WHERE status = 'active'`);
  await owner().query(`UPDATE wpcampaigns SET retry_enabled = false WHERE retry_enabled`);
  await owner().query(
    `UPDATE wp_campaign_contacts SET retry_state = 'exhausted' WHERE retry_state IN ('scheduled', 'sending', 'sent')`,
  );
});
const at = (iso: string) => {
  lab.clock.now = new Date(iso);
};
const iso = (d: Date | string) => new Date(d).toISOString();

interface RuleInput {
  frequency?: 'daily' | 'weekly' | 'monthly';
  interval?: number;
  startDate: string;
  timeOfDay?: string;
  timezone?: string;
  weekdays?: number[];
  monthDay?: number | null;
  ends?: object;
}

async function launchSeries(
  w: World,
  rule: RuleInput,
  o: { contacts?: number; retries?: object } = {},
) {
  await payPerMessage(lab, w.t, 5_000_000);
  const ids = await people(
    lab,
    w.t,
    Array.from({ length: o.contacts ?? 2 }, () => ({})),
  );
  const g = await group(owner(), w.t, `G${Math.random()}`, ids);
  const d = await makeDraft(
    lab,
    w,
    readyDraft(w, g, {
      schedule: {
        mode: 'recurring',
        rule: {
          frequency: 'daily',
          interval: 1,
          timeOfDay: '09:00',
          timezone: 'UTC',
          weekdays: [],
          ends: { kind: 'never' },
          ...rule,
        },
      },
      ...(o.retries ? { retries: o.retries } : {}),
    }),
  );
  // The wizard refuses a start in the past: launch "now", then the test's clock goes to the rule.
  lab.clock.now = new Date();
  const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
    rowVersion: d.rowVersion,
  });
  if (res.status !== 200) throw new Error(`launch ${res.status}: ${JSON.stringify(res.body)}`);
  const row = (
    await owner().query(`SELECT id, org_id FROM camp_series WHERE uuid = $1`, [res.body.id])
  ).rows[0];
  return { uuid: res.body.id as string, id: Number(row.id), orgId: Number(row.org_id), group: g };
}

const seriesState = async (uuid: string) =>
  (
    await owner().query(
      `SELECT status, next_index, occurrences_created AS created, occurrences_skipped AS skipped, next_run_at FROM camp_series WHERE uuid = $1`,
      [uuid],
    )
  ).rows[0];
const runs = async (seriesId: number) =>
  (
    await owner().query(
      `SELECT occurrence_no AS no, run_at, status, total_recipients AS n, to_char(send_date, 'YYYY-MM-DD') AS d, to_char(send_time, 'HH24:MI') AS t, wizard->'launch'->>'error' AS error
       FROM wpcampaigns WHERE series_id = $1 ORDER BY occurrence_no`,
      [seriesId],
    )
  ).rows.map((r) => ({ ...r, no: Number(r.no), run_at: iso(r.run_at) }));

// ------------------------------------------------------------------------------------------------ the planner

describe('recurring broadcasts: the planner', () => {
  it('creates one run per occurrence, each exactly when it is due, then ends after N; nothing is created early or twice', async () => {
    const w = await world(lab, 'bws1');
    const start = '2027-02-01';
    const s = await launchSeries(w, { startDate: start, ends: { kind: 'after', occurrences: 3 } });

    at('2027-01-31T23:59:00Z');
    expect(await lab.series.tick()).toBe(0);
    expect(await runs(s.id)).toEqual([]);

    at('2027-02-01T09:00:00Z');
    expect(await lab.series.tick()).toBe(1);
    expect(await lab.series.tick()).toBe(0);
    let r = await runs(s.id);
    expect(r).toEqual([
      {
        no: 0,
        run_at: '2027-02-01T09:00:00.000Z',
        status: 'running',
        n: 2,
        d: '2027-02-01',
        t: '09:00',
        error: null,
      },
    ]);
    expect(lab.enqueued.at(-1)).toMatchObject({ orgId: s.orgId });
    expect(iso((await seriesState(s.uuid)).next_run_at)).toBe('2027-02-02T09:00:00.000Z');

    at('2027-02-02T09:00:00Z');
    await lab.series.tick();
    at('2027-02-03T09:00:00Z');
    await lab.series.tick();
    r = await runs(s.id);
    expect(r.map((x) => [x.no, x.run_at])).toEqual([
      [0, '2027-02-01T09:00:00.000Z'],
      [1, '2027-02-02T09:00:00.000Z'],
      [2, '2027-02-03T09:00:00.000Z'],
    ]);
    expect(await seriesState(s.uuid)).toMatchObject({
      status: 'ended',
      created: 3,
      next_run_at: null,
    });

    at('2027-02-10T09:00:00Z');
    expect(await lab.series.tick()).toBe(0);
    expect(await runs(s.id)).toHaveLength(3);
  });

  it('weekly on the picked weekdays, every second week', async () => {
    const w = await world(lab, 'bws2');
    // 2027-03-01 is a Monday.
    const s = await launchSeries(w, {
      frequency: 'weekly',
      interval: 2,
      startDate: '2027-03-01',
      weekdays: [1, 4],
      ends: { kind: 'after', occurrences: 4 },
    });
    for (const when of ['2027-03-01', '2027-03-04', '2027-03-15', '2027-03-18']) {
      at(`${when}T09:00:00Z`);
      await lab.series.tick();
    }
    expect((await runs(s.id)).map((x) => x.d)).toEqual([
      '2027-03-01',
      '2027-03-04',
      '2027-03-15',
      '2027-03-18',
    ]);
    expect((await seriesState(s.uuid)).status).toBe('ended');
  });

  it('monthly on the 31st clamps to the end of a short month', async () => {
    const w = await world(lab, 'bws3');
    const s = await launchSeries(w, {
      frequency: 'monthly',
      startDate: '2027-01-31',
      ends: { kind: 'after', occurrences: 4 },
    });
    for (const when of ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']) {
      at(`${when}T09:00:00Z`);
      await lab.series.tick();
    }
    expect((await runs(s.id)).map((x) => x.d)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
  });

  it('"ends on a date" includes that day and not the next', async () => {
    const w = await world(lab, 'bws4');
    const s = await launchSeries(w, {
      startDate: '2027-05-01',
      ends: { kind: 'on_date', date: '2027-05-03' },
    });
    for (const d of ['01', '02', '03', '04', '05']) {
      at(`2027-05-${d}T09:00:00Z`);
      await lab.series.tick();
    }
    expect((await runs(s.id)).map((x) => x.d)).toEqual(['2027-05-01', '2027-05-02', '2027-05-03']);
    expect((await seriesState(s.uuid)).status).toBe('ended');
  });

  it('keeps 09:00 on the clock of the zone across a daylight-saving change', async () => {
    const w = await world(lab, 'bws5');
    // The US springs forward on 2027-03-14.
    const s = await launchSeries(w, {
      startDate: '2027-03-13',
      timezone: 'America/New_York',
      ends: { kind: 'after', occurrences: 3 },
    });
    const due = ['2027-03-13T14:00:00Z', '2027-03-14T13:00:00Z', '2027-03-15T13:00:00Z'];
    for (const when of due) {
      at(when);
      await lab.series.tick();
    }
    const r = await runs(s.id);
    expect(r.map((x) => x.run_at)).toEqual(due.map((d) => iso(d)));
    expect(r.every((x) => x.t === '09:00')).toBe(true);
  });

  it('an outage steps over the runs that went stale instead of sending them all at once', async () => {
    const w = await world(lab, 'bws6');
    const s = await launchSeries(w, { startDate: '2027-06-01' });
    // Four days later, one hour past the fourth occurrence.
    at('2027-06-04T10:00:00Z');
    expect(await lab.series.tick()).toBe(1);
    const r = await runs(s.id);
    expect(r.map((x) => [x.no, x.run_at])).toEqual([[3, '2027-06-04T09:00:00.000Z']]);
    expect(await seriesState(s.uuid)).toMatchObject({ created: 1, skipped: 3, next_index: 4 });
    expect(iso((await seriesState(s.uuid)).next_run_at)).toBe('2027-06-05T09:00:00.000Z');
    expect(MISFIRE_GRACE_MS).toBe(6 * 3_600_000);
  });

  it('a run that is only a little late (inside the grace) still goes', async () => {
    const w = await world(lab, 'bws7');
    const s = await launchSeries(w, { startDate: '2027-07-01' });
    at('2027-07-01T13:00:00Z');
    expect(await lab.series.tick()).toBe(1);
    expect((await runs(s.id))[0]).toMatchObject({ no: 0, run_at: '2027-07-01T09:00:00.000Z' });
  });

  it('each run is built from the audience as it is then: a contact added after the launch is in the next run', async () => {
    const w = await world(lab, 'bws8');
    const s = await launchSeries(w, { startDate: '2027-08-01' }, { contacts: 2 });
    const [late] = await people(lab, w.t, [{ name: 'Late joiner' }]);
    await owner().query(
      `INSERT INTO contact_group_members (org_id, group_id, contact_id)
       SELECT $1, g.id, c.id FROM contact_groups g, contacts c WHERE g.uuid = $2 AND c.uuid = $3 AND g.org_id = $1 AND c.org_id = $1`,
      [w.t.orgId, s.group, late],
    );
    at('2027-08-01T09:00:00Z');
    await lab.series.tick();
    expect((await runs(s.id))[0]!.n).toBe(3);
  });

  it('a run the wallet cannot cover is recorded as failed with the reason, and the series goes on', async () => {
    const w = await world(lab, 'bws9');
    const s = await launchSeries(w, {
      startDate: '2027-09-01',
      ends: { kind: 'after', occurrences: 2 },
    });
    await owner().query(`UPDATE wallets SET balance = 0, reserved = 0 WHERE org_id = $1`, [
      w.t.orgId,
    ]);
    at('2027-09-01T09:00:00Z');
    await lab.series.tick();
    expect(await runs(s.id)).toMatchObject([
      { no: 0, status: 'failed', n: 0, error: 'WALLET_EMPTY' },
    ]);
    expect(await seriesState(s.uuid)).toMatchObject({
      status: 'active',
      created: 1,
      next_index: 1,
    });
    // Topped up, the next run goes.
    await payPerMessage(lab, w.t, 5_000_000);
    at('2027-09-02T09:00:00Z');
    await lab.series.tick();
    expect((await runs(s.id)).map((x) => [x.no, x.status])).toEqual([
      [0, 'failed'],
      [1, 'running'],
    ]);
  });

  it('a paused series plans nothing, and resumes without a burst for what it missed', async () => {
    const w = await world(lab, 'bws10');
    const s = await launchSeries(w, { startDate: '2027-10-01' });
    expect((await wiz(lab, w.t.admin).post(`/broadcasts/${s.uuid}/pause`)).status).toBe(200);
    at('2027-10-05T09:00:00Z');
    expect(await lab.series.tick()).toBe(0);
    expect(await runs(s.id)).toEqual([]);
    expect((await wiz(lab, w.t.admin).post(`/broadcasts/${s.uuid}/resume`)).status).toBe(200);
    expect(await lab.series.tick()).toBe(1);
    const r = await runs(s.id);
    expect(r).toHaveLength(1);
    expect(r[0]!.no).toBe(4);
  });

  it('a cancelled series plans nothing more and stops the runs it started', async () => {
    const w = await world(lab, 'bws11');
    const s = await launchSeries(w, { startDate: '2027-11-01' });
    at('2027-11-01T09:00:00Z');
    await lab.series.tick();
    expect((await runs(s.id))[0]!.status).toBe('running');
    expect((await wiz(lab, w.t.admin).post(`/broadcasts/${s.uuid}/cancel`)).body.status).toBe(
      'cancelled',
    );
    expect((await runs(s.id))[0]!.status).toBe('cancelled');
    at('2027-11-02T09:00:00Z');
    expect(await lab.series.tick()).toBe(0);
  });

  it('two workers planning the same series at once make one run', async () => {
    const w = await world(lab, 'bws12');
    const s = await launchSeries(w, { startDate: '2027-12-01' });
    at('2027-12-01T09:00:00Z');
    const made = await Promise.all([
      lab.series.planOne(s.orgId, s.id),
      lab.series.planOne(s.orgId, s.id),
      lab.series.planOne(s.orgId, s.id),
    ]);
    expect(made.filter(Boolean)).toHaveLength(1);
    expect(await runs(s.id)).toHaveLength(1);
  });

  it('a run of a series is sent like any campaign: the sandbox gets the mapped variable', async () => {
    const w = await world(lab, 'bws13');
    const s = await launchSeries(w, { startDate: '2028-01-03' });
    at('2028-01-03T09:00:00Z');
    await lab.series.tick();
    const run = (await owner().query(`SELECT id FROM wpcampaigns WHERE series_id = $1`, [s.id]))
      .rows[0];
    lab.sent.length = 0;
    expect(await lab.run(s.orgId, Number(run.id))).toBe('finished');
    expect(lab.sent).toHaveLength(2);
    expect(lab.sent.every((m) => JSON.stringify(m.components).includes('there'))).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ frequency-cap retries

describe('retries for Meta frequency capping (131049)', () => {
  /** Contacts whose numbers the sandbox answers differently (see the sandbox rules): who recovers when, who never does. */
  async function launchNow(label: string, retries: object | null) {
    const w = await world(lab, label);
    await payPerMessage(lab, w.t, 5_000_000);
    const who = {
      once: number('1049'),
      twice: number('2049'),
      never: number('9049'),
      dead: number('0000'),
      fine: number('1234'),
    };
    const ids = await people(
      lab,
      w.t,
      Object.entries(who).map(([name, phone]) => ({ name, phone })),
    );
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g, retries ? { retries } : {}));
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { id, orgId } = await idOfCampaign(owner(), d.id);
    lab.clock.now = new Date();
    lab.sent.length = 0;
    expect(await lab.run(orgId, id)).toBe('finished');
    await lab.flush();
    return { w, id, orgId, uuid: d.id, who };
  }

  const recipients = async (campaignId: number) => {
    const r = await owner().query(
      `SELECT c.name, r.status, r.error_code, r.retry_state, r.retry_count, r.retry_next_at, r.retry_first_sent_at, r.whatsapp_message_id
       FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
       WHERE r.campaign_id = $1 ORDER BY c.name`,
      [campaignId],
    );
    return Object.fromEntries(r.rows.map((x) => [x.name as string, x]));
  };
  const attempts = async (campaignId: number) => {
    const r = await owner().query(
      `SELECT c.name, a.attempt_no, a.scheduled_for, a.executed_at, a.outcome, a.provider_message_id
       FROM camp_retry_attempts a JOIN wp_campaign_contacts r ON r.org_id = a.org_id AND r.id = a.recipient_id
       JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id WHERE a.campaign_id = $1 ORDER BY c.name, a.attempt_no`,
      [campaignId],
    );
    return r.rows.map((x) => ({
      ...x,
      attempt_no: Number(x.attempt_no),
      scheduled_for: iso(x.scheduled_for),
      executed_at: iso(x.executed_at),
    }));
  };
  const dayAfter = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  it('the first send: the cap shows as a failure with its code, the undeliverable one as a different failure, the rest delivered', async () => {
    const c = await launchNow('bwr1', { enabled: true, endDate: dayAfter(2), timezone: 'UTC' });
    const r = await recipients(c.id);
    expect(['once', 'twice', 'never'].map((n) => [r[n].status, r[n].error_code])).toEqual([
      ['failed', '131049'],
      ['failed', '131049'],
      ['failed', '131049'],
    ]);
    expect([r.dead.status, r.dead.error_code]).toEqual(['failed', '131026']);
    expect(r.fine.status).toBe('delivered');
    expect(Object.values(r).every((x) => x.retry_state === null)).toBe(true);
  });

  it('retries only the frequency cap: armed at exactly 24 hours after the first send, never the undeliverable or the delivered', async () => {
    const c = await launchNow('bwr2', { enabled: true, endDate: dayAfter(2), timezone: 'UTC' });
    const out = await lab.retries.tick();
    expect(out.armed).toBe(3);
    const r = await recipients(c.id);
    for (const n of ['once', 'twice', 'never']) {
      expect(r[n].retry_state).toBe('scheduled');
      expect(iso(r[n].retry_next_at)).toBe(
        new Date(new Date(r[n].retry_first_sent_at).getTime() + 86_400_000).toISOString(),
      );
    }
    expect(r.dead.retry_state).toBeNull();
    expect(r.fine.retry_state).toBeNull();
    // Nothing is due yet: no message goes.
    lab.sent.length = 0;
    expect((await lab.retries.tick()).sent).toBe(0);
    expect(lab.sent).toHaveLength(0);
  });

  it('runs each retry exactly 24 hours after the last until the end date, then stops; a recovered message is never sent again', async () => {
    const c = await launchNow('bwr3', { enabled: true, endDate: dayAfter(2), timezone: 'UTC' });
    await lab.retries.tick();
    const first = await recipients(c.id);
    // Each recipient's anchor is its own send time, a few milliseconds apart: 24 hours on, everyone's slot is due.
    const latest = (rows: Array<{ retry_next_at: unknown }>) =>
      new Date(Math.max(...rows.map((x) => new Date(x.retry_next_at as string).getTime())));
    const t1 = latest([first.once, first.twice, first.never]);

    // 24 hours on: all three are retried; `once` goes through (the sandbox lets the first retry in), the others are refused again.
    at(t1.toISOString());
    lab.sent.length = 0;
    expect((await lab.retries.tick()).sent).toBe(3);
    expect(lab.sent.map((m) => m.clientReference.replace(/^camp-\d+-\d+/, '')).sort()).toEqual([
      '-r1',
      '-r1',
      '-r1',
    ]);
    await lab.flush();
    await lab.retries.tick();
    let r = await recipients(c.id);
    expect(r.once).toMatchObject({ status: 'delivered', retry_state: 'recovered' });
    expect(r.twice).toMatchObject({ status: 'failed', retry_state: 'scheduled' });
    expect(r.never).toMatchObject({ status: 'failed', retry_state: 'scheduled' });
    expect(
      new Date(r.twice.retry_next_at as string).getTime() -
        new Date(first.twice.retry_next_at as string).getTime(),
    ).toBe(86_400_000);

    // Running it again at the same instant does nothing: the slot was used, the next is a day away.
    lab.sent.length = 0;
    expect((await lab.retries.tick()).sent).toBe(0);

    // 48 hours: `twice` goes through; `never` is refused again and its next slot would be past the window: it ends.
    at(latest([r.twice, r.never]).toISOString());
    expect((await lab.retries.tick()).sent).toBe(2);
    await lab.flush();
    await lab.retries.tick();
    r = await recipients(c.id);
    expect(r.twice).toMatchObject({ status: 'delivered', retry_state: 'recovered' });
    expect(r.never.retry_state).toBe('exhausted');
    expect(r.never.status).toBe('failed');

    // Days later nothing is retried any more, and `once`, `twice` were each sent exactly the times they needed.
    lab.sent.length = 0;
    at(new Date(t1.getTime() + 10 * 86_400_000).toISOString());
    expect((await lab.retries.tick()).sent).toBe(0);
    expect(lab.sent).toHaveLength(0);

    const log = await attempts(c.id);
    expect(log.filter((a) => a.name === 'once').map((a) => [a.attempt_no, a.outcome])).toEqual([
      [1, 'sent'],
    ]);
    expect(log.filter((a) => a.name === 'twice').map((a) => [a.attempt_no, a.outcome])).toEqual([
      [1, 'frequency_cap'],
      [2, 'sent'],
    ]);
    expect(log.filter((a) => a.name === 'never').map((a) => [a.attempt_no, a.outcome])).toEqual([
      [1, 'frequency_cap'],
      [2, 'frequency_cap'],
    ]);
    expect(log.some((a) => a.name === 'dead' || a.name === 'fine')).toBe(false);

    // Exactly 24 hours between the slots, and each ran at its slot.
    const never = log.filter((a) => a.name === 'never');
    expect(
      new Date(never[1]!.scheduled_for).getTime() - new Date(never[0]!.scheduled_for).getTime(),
    ).toBe(86_400_000);
    for (const a of log) {
      const late = new Date(a.executed_at).getTime() - new Date(a.scheduled_for).getTime();
      expect(late).toBeGreaterThanOrEqual(0);
      expect(late).toBeLessThan(1000);
    }
  });

  it('without retries switched on, a frequency-cap failure is final: nothing is armed and nothing is resent', async () => {
    const c = await launchNow('bwr4', null);
    const out = await lab.retries.tick();
    expect(out).toMatchObject({ armed: 0, sent: 0 });
    at(new Date(Date.now() + 3 * 86_400_000).toISOString());
    lab.sent.length = 0;
    expect((await lab.retries.tick()).sent).toBe(0);
    const r = await recipients(c.id);
    expect(r.once).toMatchObject({ status: 'failed', retry_state: null });
    expect(await attempts(c.id)).toEqual([]);
  });

  it('the run itself leaves the cap to the retry job: no 6-hour backoff on a wizard campaign', async () => {
    const c = await launchNow('bwr5', { enabled: true, endDate: dayAfter(2), timezone: 'UTC' });
    const camp = (await owner().query(`SELECT status FROM wpcampaigns WHERE id = $1`, [c.id]))
      .rows[0];
    expect(camp.status).toBe('completed');
    const r = await owner().query(
      `SELECT count(*)::int AS n FROM wp_campaign_contacts WHERE campaign_id = $1 AND next_attempt_at IS NOT NULL`,
      [c.id],
    );
    expect(r.rows[0].n).toBe(0);
  });

  it('a cancelled campaign is not retried', async () => {
    const c = await launchNow('bwr6', { enabled: true, endDate: dayAfter(2), timezone: 'UTC' });
    await lab.retries.tick();
    await owner().query(`UPDATE wpcampaigns SET status = 'cancelled' WHERE id = $1`, [c.id]);
    const r = await recipients(c.id);
    at(new Date(new Date(r.once.retry_next_at as string).getTime() + 1000).toISOString());
    lab.sent.length = 0;
    expect((await lab.retries.tick()).sent).toBe(0);
  });

  it('a slot claimed by two workers at once is sent once (the claim and the attempt log both guard it)', async () => {
    const c = await launchNow('bwr7', { enabled: true, endDate: dayAfter(2), timezone: 'UTC' });
    await lab.retries.tick();
    const r = await recipients(c.id);
    at(
      new Date(
        Math.max(
          ...['once', 'twice', 'never'].map((n) =>
            new Date(r[n].retry_next_at as string).getTime(),
          ),
        ),
      ).toISOString(),
    );
    lab.sent.length = 0;
    const [a, b] = await Promise.all([lab.retries.runDue(), lab.retries.runDue()]);
    expect(a + b).toBe(3);
    expect(lab.sent).toHaveLength(3);
    expect((await attempts(c.id)).filter((x) => x.name === 'once')).toHaveLength(1);
  });

  it('a claim whose worker died before the provider was called goes back; one that may have gone out ends the retries', async () => {
    const c = await launchNow('bwr8', { enabled: true, endDate: dayAfter(2), timezone: 'UTC' });
    await lab.retries.tick();
    const r = await recipients(c.id);
    // Two stuck claims, an hour old.
    await owner().query(
      `UPDATE wp_campaign_contacts r SET retry_state = 'sending', updated_at = now() - interval '1 hour'
       FROM contacts c WHERE c.org_id = r.org_id AND c.id = r.contact_id AND r.campaign_id = $1 AND c.name IN ('once', 'twice')`,
      [c.id],
    );
    // For `twice` an attempt was logged before the crash.
    const twice = (
      await owner().query(
        `SELECT r.id FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id WHERE r.campaign_id = $1 AND c.name = 'twice'`,
        [c.id],
      )
    ).rows[0].id;
    await owner().query(
      `INSERT INTO camp_retry_attempts (org_id, campaign_id, recipient_id, attempt_no, scheduled_for, outcome) VALUES ($1, $2, $3, 1, now(), 'failed')`,
      [c.orgId, c.id, twice],
    );
    at(new Date(Date.now() + 3_600_000).toISOString());
    expect(await lab.retries.reap()).toBe(2);
    const after = await recipients(c.id);
    expect(after.once.retry_state).toBe('scheduled');
    expect(after.twice.retry_state).toBe('exhausted');
    void r;
  });

  it('the wallet: a failed message is never charged, a retry is charged when it is delivered, and a repeated report charges nothing more', async () => {
    const c = await launchNow('bwr9', { enabled: true, endDate: dayAfter(2), timezone: 'UTC' });
    await lab.retries.tick();
    const r = await recipients(c.id);
    at(new Date(r.once.retry_next_at as string).toISOString());
    await lab.retries.tick();
    await lab.flush();
    const billing = lab.h.app.get(MessageBillingService, { strict: false });
    const events = (
      await owner().query(
        `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
        [c.orgId, MESSAGE_DELIVERY_EVENT],
      )
    ).rows.map((x) => walletDeliveryReportedSchema.parse(x.payload));
    const before = await balanceMinor(lab, c.orgId);
    for (const e of events) {
      if (e.status === 'failed') await billing.settleFailed(c.orgId, e.providerMessageId);
      else
        await billing.settleDelivered({
          orgId: c.orgId,
          provider: e.provider,
          providerMessageId: e.providerMessageId,
          recipient: e.recipient ?? null,
          category: e.category ?? null,
          source: e.source ?? null,
        });
    }
    const onceMsg = (await recipients(c.id)).once.whatsapp_message_id as string;
    const charged = await owner().query(
      `SELECT wamid, status FROM usage_charges WHERE org_id = $1 AND status = 'charged' ORDER BY id`,
      [c.orgId],
    );
    const wamids = charged.rows.map((x) => x.wamid as string);
    // `fine` was delivered by the first send, `once` by its retry: two charged messages, each once, none for a failed one.
    expect(wamids).toHaveLength(2);
    expect(new Set(wamids).size).toBe(2);
    expect(wamids).toContain(onceMsg);
    const afterFirst = await balanceMinor(lab, c.orgId);
    expect(afterFirst).toBeLessThan(before);
    // The same reports again change nothing.
    for (const e of events.filter((x) => x.status !== 'failed')) {
      await billing.settleDelivered({
        orgId: c.orgId,
        provider: e.provider,
        providerMessageId: e.providerMessageId,
        recipient: e.recipient ?? null,
        category: e.category ?? null,
        source: e.source ?? null,
      });
    }
    expect(await balanceMinor(lab, c.orgId)).toBe(afterFirst);
  });
});

// ------------------------------------------------------------------------------------------------ the test send

describe('retry failed (by hand) on a launched broadcast', () => {
  async function finished(label: string) {
    const w = await world(lab, label);
    await payPerMessage(lab, w.t, 5_000_000);
    const who = {
      once: number('1049'),
      never: number('9049'),
      dead: number('0000'),
      fine: number('1234'),
    };
    const ids = await people(
      lab,
      w.t,
      Object.entries(who).map(([name, phone]) => ({ name, phone })),
    );
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        retries: {
          enabled: true,
          endDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
          timezone: 'UTC',
        },
      }),
    );
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { id, orgId } = await idOfCampaign(owner(), d.id);
    lab.clock.now = new Date();
    expect(await lab.run(orgId, id)).toBe('finished');
    await lab.flush();
    return { w, id, orgId, uuid: d.id };
  }
  const rows = async (campaignId: number) =>
    Object.fromEntries(
      (
        await owner().query(
          `SELECT c.name, r.status, r.error_code, r.retry_state, r.retry_count FROM wp_campaign_contacts r
           JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id WHERE r.campaign_id = $1`,
          [campaignId],
        )
      ).rows.map((x) => [x.name as string, x]),
    );
  const attemptCount = async (campaignId: number) =>
    Number(
      (
        await owner().query(
          `SELECT count(*) AS n FROM camp_retry_attempts WHERE campaign_id = $1`,
          [campaignId],
        )
      ).rows[0].n,
    );

  it('puts only the failed recipients back in the queue, clears their retry state and attempt log, and they can be armed again after the next failure', async () => {
    const c = await finished('bwf1');
    await lab.retries.tick(); // arms the three frequency-cap failures
    expect((await rows(c.id)).once.retry_state).toBe('scheduled');

    const res = await wiz(lab, c.w.t.admin).post(`/broadcasts/${c.uuid}/retry-failed`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(wizardRetryFailedResponseSchema.parse(res.body)).toMatchObject({
      id: c.uuid,
      kind: 'campaign',
      status: 'running',
      recipients: 3,
      runs: 1,
    });

    const r = await rows(c.id);
    for (const n of ['once', 'never', 'dead']) {
      expect(r[n]).toMatchObject({
        status: 'queued',
        error_code: null,
        retry_state: null,
        retry_count: 0,
      });
    }
    expect(r.fine.status).toBe('delivered');
    expect(await attemptCount(c.id)).toBe(0);

    // A broadcast that is running again cannot be retried a second time on top of itself.
    const twice = await wiz(lab, c.w.t.admin).post(`/broadcasts/${c.uuid}/retry-failed`);
    expect(twice.status).toBe(422);
    expect(problem(twice).code).toBe('CAMP_NOT_RESENDABLE');

    // Run it again: the frequency-cap failures are armed from a clean slate, not skipped as a duplicate attempt.
    lab.sent.length = 0;
    expect(await lab.run(c.orgId, c.id)).toBe('finished');
    await lab.flush();
    expect(lab.sent.map((m) => `+${m.to}`).sort()).toEqual(
      [number('0000'), number('1049'), number('9049')].sort(),
    );
    expect((await lab.retries.tick()).armed).toBe(2);
    expect((await rows(c.id)).never.retry_state).toBe('scheduled');
  });

  it('nothing to retry is a 422 with its own code; another workspace gets a 404', async () => {
    const c = await finished('bwf2');
    // A delivered-only campaign: reset the failures by hand so nobody is left failed.
    await owner().query(
      `UPDATE wp_campaign_contacts SET status = 'delivered' WHERE campaign_id = $1 AND status = 'failed'`,
      [c.id],
    );
    const none = await wiz(lab, c.w.t.admin).post(`/broadcasts/${c.uuid}/retry-failed`);
    expect(none.status).toBe(422);
    expect(problem(none).code).toBe('CAMP_NOTHING_TO_RESEND');

    const other = await world(lab, 'bwf2b');
    expect((await wiz(lab, other.t.admin).post(`/broadcasts/${c.uuid}/retry-failed`)).status).toBe(
      404,
    );
    expect((await rows(c.id)).fine.status).toBe('delivered');
  });

  it('a recurring series retries the failed recipients of every finished run, and leaves a run still in progress alone', async () => {
    const w = await world(lab, 'bwf3');
    await payPerMessage(lab, w.t, 5_000_000);
    const ids = await people(lab, w.t, [{}, {}]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        schedule: {
          mode: 'recurring',
          rule: {
            frequency: 'daily',
            interval: 1,
            startDate: '2028-02-01',
            timeOfDay: '09:00',
            timezone: 'UTC',
            weekdays: [],
            ends: { kind: 'never' },
          },
        },
      }),
    );
    lab.clock.now = new Date();
    const launch = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(launch.status, JSON.stringify(launch.body)).toBe(200);
    const series = (
      await owner().query(`SELECT id FROM camp_series WHERE uuid = $1`, [launch.body.id])
    ).rows[0];
    at('2028-02-01T09:00:00Z');
    await lab.series.tick();
    at('2028-02-02T09:00:00Z');
    await lab.series.tick();
    const children = (
      await owner().query(
        `SELECT id FROM wpcampaigns WHERE series_id = $1 ORDER BY occurrence_no`,
        [series.id],
      )
    ).rows.map((x) => Number(x.id));
    expect(children).toHaveLength(2);
    // Run 1 finished with a failure; run 2 is still running with one too.
    await owner().query(`UPDATE wpcampaigns SET status = 'completed' WHERE id = $1`, [children[0]]);
    await owner().query(`UPDATE wpcampaigns SET status = 'running' WHERE id = $1`, [children[1]]);
    for (const id of children) {
      await owner().query(
        `UPDATE wp_campaign_contacts SET status = 'failed', error_message = 'boom' WHERE id = (SELECT min(id) FROM wp_campaign_contacts WHERE campaign_id = $1)`,
        [id],
      );
    }
    // A cancelled run is never restarted by the series' retry.
    await owner().query(`UPDATE wpcampaigns SET status = 'cancelled' WHERE id = $1`, [children[1]]);
    const res = await wiz(lab, w.t.admin).post(`/broadcasts/${launch.body.id}/retry-failed`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ kind: 'series', recipients: 1, runs: 1 });
    const left = (
      await owner().query(
        `SELECT campaign_id, count(*) FILTER (WHERE status = 'failed') AS failed FROM wp_campaign_contacts WHERE campaign_id = ANY($1) GROUP BY campaign_id ORDER BY campaign_id`,
        [children],
      )
    ).rows.map((x) => Number(x.failed));
    expect(left).toEqual([0, 1]);
  });
});

describe('export and delete of a launched broadcast', () => {
  const day = (n: number) =>
    new Date(lab.clock.now.getTime() + n * 86_400_000).toISOString().slice(0, 10);

  /** A one-off broadcast scheduled two days ahead, with `n` recipients. */
  async function oneOff(label: string, n = 2) {
    const w = await world(lab, label);
    await payPerMessage(lab, w.t, 1_000_000);
    const ids = await people(
      lab,
      w.t,
      Array.from({ length: n }, () => ({})),
    );
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        schedule: { mode: 'scheduled', date: day(2), time: '09:00', timezone: 'UTC' },
      }),
    );
    lab.clock.now = new Date();
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { w, uuid: d.id as string };
  }
  const del = (token: string, id: string) =>
    lab.api.http().delete(`/v2/broadcast-wizard/broadcasts/${id}`).set(bearer(token));
  const rowsOf = async (table: 'wpcampaigns' | 'camp_series', uuid: string) =>
    Number(
      (await owner().query(`SELECT count(*) AS n FROM ${table} WHERE uuid = $1`, [uuid])).rows[0].n,
    );

  it('deletes a one-off broadcast with its recipients; another workspace gets 404 and nothing is touched', async () => {
    const b = await oneOff('bwd1', 3);
    const other = await world(lab, 'bwd1b');
    expect((await del(other.t.admin, b.uuid)).status).toBe(404);
    expect(await rowsOf('wpcampaigns', b.uuid)).toBe(1);

    const res = await del(b.w.t.admin, b.uuid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(wizardDeleteResponseSchema.parse(res.body)).toMatchObject({
      id: b.uuid,
      kind: 'campaign',
      runs: 1,
    });
    expect(await rowsOf('wpcampaigns', b.uuid)).toBe(0);
    expect((await wiz(lab, b.w.t.admin).get(`/broadcasts/${b.uuid}`)).status).toBe(404);
    expect((await del(b.w.t.admin, b.uuid)).status).toBe(404);
    const left = await owner().query(
      `SELECT count(*) AS n FROM wp_campaign_contacts r WHERE r.org_id = $1 AND NOT EXISTS (SELECT 1 FROM wpcampaigns c WHERE c.org_id = r.org_id AND c.id = r.campaign_id)`,
      [b.w.t.orgId],
    );
    expect(Number(left.rows[0].n)).toBe(0);
  });

  it('exports a one-off broadcast exactly as its campaign export does, and refuses another workspace', async () => {
    const b = await oneOff('bwd2', 2);
    const res = await wiz(lab, b.w.t.admin).get(`/broadcasts/${b.uuid}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="campaign-.+-recipients-\d{8}-\d{6}\.csv"/,
    );
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Recipient,Phone,Variant,Status,Clicked,Queued,Sent,Delivered,Read,Responded,Last event,Error',
    );
    expect(lines).toHaveLength(3);
    const same = await lab.api
      .http()
      .get(`/v2/campaigns/${b.uuid}/export`)
      .set(bearer(b.w.t.admin));
    expect(same.text.trim().split('\r\n')[0]).toBe(lines[0]);
    const other = await world(lab, 'bwd2b');
    expect((await wiz(lab, other.t.admin).get(`/broadcasts/${b.uuid}/export`)).status).toBe(404);
  });

  /** A daily series that has planned two runs, each with two recipients. */
  async function seriesWithRuns(label: string) {
    const w = await world(lab, label);
    const s = await launchSeries(w, { startDate: '2028-03-01' });
    at('2028-03-01T09:00:00Z');
    await lab.series.tick();
    at('2028-03-02T09:00:00Z');
    await lab.series.tick();
    const runIds = (
      await owner().query(
        `SELECT id, uuid FROM wpcampaigns WHERE series_id = $1 ORDER BY occurrence_no`,
        [s.id],
      )
    ).rows;
    expect(runIds).toHaveLength(2);
    // The planner starts a due run at once; these tests need the runs quiet, as they are between sends.
    await owner().query(`UPDATE wpcampaigns SET status = 'scheduled' WHERE series_id = $1`, [s.id]);
    return { w, s, runIds };
  }

  it('deletes a recurring series with the runs it had planned while nothing has been sent, and keeps the history of one that has', async () => {
    const a = await seriesWithRuns('bwd3');
    const noRuns = await oneSeries('bwd3x');
    expect((await del(noRuns.w.t.admin, noRuns.uuid)).body).toMatchObject({
      kind: 'series',
      runs: 0,
    });
    expect(await rowsOf('camp_series', noRuns.uuid)).toBe(0);

    // Nothing sent yet: the series and both runs (with their recipients) go.
    const res = await del(a.w.t.admin, a.s.uuid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(wizardDeleteResponseSchema.parse(res.body)).toMatchObject({
      id: a.s.uuid,
      kind: 'series',
      runs: 2,
    });
    expect(await rowsOf('camp_series', a.s.uuid)).toBe(0);
    const left = await owner().query(`SELECT count(*) AS n FROM wpcampaigns WHERE id = ANY($1)`, [
      a.runIds.map((r) => r.id),
    ]);
    expect(Number(left.rows[0].n)).toBe(0);

    // A run that has sent a message: the history is kept, the series stays, and it can still be cancelled.
    const b = await seriesWithRuns('bwd4');
    await owner().query(
      `UPDATE wp_campaign_contacts SET status = 'sent', sent_at = now() WHERE id = (SELECT min(id) FROM wp_campaign_contacts WHERE campaign_id = $1)`,
      [b.runIds[0]!.id],
    );
    const kept = await del(b.w.t.admin, b.s.uuid);
    expect(kept.status).toBe(409);
    expect(problem(kept).code).toBe('CAMP_SERIES_HAS_HISTORY');
    expect(await rowsOf('camp_series', b.s.uuid)).toBe(1);
    expect((await wiz(lab, b.w.t.admin).post(`/broadcasts/${b.s.uuid}/cancel`)).status).toBe(200);

    // A run that is going right now is never deleted under the worker.
    const c = await seriesWithRuns('bwd5');
    await owner().query(`UPDATE wpcampaigns SET status = 'running' WHERE id = $1`, [
      c.runIds[1]!.id,
    ]);
    const busy = await del(c.w.t.admin, c.s.uuid);
    expect(busy.status).toBe(422);
    expect(problem(busy).code).toBe('CAMP_BROADCAST_NOT_CONTROLLABLE');
    expect(await rowsOf('camp_series', c.s.uuid)).toBe(1);
  });

  /** A launched series that has not planned any run yet. */
  async function oneSeries(label: string) {
    const w = await world(lab, label);
    const s = await launchSeries(w, { startDate: '2028-04-01' });
    return { w, uuid: s.uuid };
  }

  it('exports a recurring series as one file with a Run column, run by run; another workspace gets 404', async () => {
    const a = await seriesWithRuns('bwd6');
    const res = await wiz(lab, a.w.t.admin).get(`/broadcasts/${a.s.uuid}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/filename="broadcast-.+-recipients-/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Run,Recipient,Phone,Variant,Status,Clicked,Queued,Sent,Delivered,Read,Responded,Last event,Error',
    );
    expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['1', '1', '2', '2']);
    // A run says which series it belongs to (the page behind its export and delete), and a one-off campaign says none.
    const run = await wiz(lab, a.w.t.admin).get(`/broadcasts/${a.s.uuid}`);
    const runUuid = run.body.runList[0].id as string;
    const detail = await lab.api.http().get(`/v2/campaigns/${runUuid}`).set(bearer(a.w.t.admin));
    expect(detail.body.campaign.seriesId).toBe(a.s.uuid);
    const other = await world(lab, 'bwd6b');
    expect((await wiz(lab, other.t.admin).get(`/broadcasts/${a.s.uuid}/export`)).status).toBe(404);
    // A series with no run yet is a file with only its header.
    const none = await oneSeries('bwd6x');
    const empty = await wiz(lab, none.w.t.admin).get(`/broadcasts/${none.uuid}/export`);
    expect(empty.text.trim().split('\r\n')).toHaveLength(1);
  });

  it('each route needs its own permission', async () => {
    const b = await oneOff('bwd7', 1);
    const reader = await lab.api.member(b.w.t, 'rd7', [['camp.campaigns.read']]);
    expect((await wiz(lab, reader.token).get(`/broadcasts/${b.uuid}/export`)).status).toBe(403);
    expect((await del(reader.token, b.uuid)).status).toBe(403);
    const exporter = await lab.api.member(b.w.t, 'ex7', [['camp.campaigns.export']]);
    expect((await wiz(lab, exporter.token).get(`/broadcasts/${b.uuid}/export`)).status).toBe(200);
    expect((await del(exporter.token, b.uuid)).status).toBe(403);
    const deleter = await lab.api.member(b.w.t, 'de7', [['camp.campaigns.delete']]);
    expect((await del(deleter.token, b.uuid)).status).toBe(200);
  });
});

describe('the test send', () => {
  async function ready(label: string, fundMinor = 5_000_000) {
    const w = await world(lab, label);
    await payPerMessage(lab, w.t, fundMinor);
    const ids = await people(lab, w.t, [{ name: 'Aarav Sharma' }]);
    await owner().query(`UPDATE contacts SET first_name = 'Aarav' WHERE uuid = $1`, [ids[0]]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g));
    return { w, d, g };
  }
  const send = (w: World, draftId: string, recipients: string) =>
    wiz(lab, w.t.admin).post('/test-send', { draftId, recipients });

  it('refuses numbers that are not E.164, more than ten, or none, naming each, and sends nothing', async () => {
    const { w, d } = await ready('bwt-v1');
    lab.sent.length = 0;
    const bad = await send(w, d.id, '+919876543210, 98765, abc');
    expect(bad.status).toBe(422);
    expect(problem(bad)).toMatchObject({
      code: 'CAMP_TEST_RECIPIENTS_INVALID',
      errors: [
        { path: 'recipients', message: 'invalid:98765' },
        { path: 'recipients', message: 'invalid:abc' },
      ],
    });
    const many = await send(
      w,
      d.id,
      Array.from({ length: 11 }, (_, i) => `+9198765432${String(10 + i)}`).join(','),
    );
    expect(problem(many).errors[0]!.message).toBe('too_many:10');
    expect((await send(w, d.id, ' , ')).status).toBe(422);
    expect(lab.sent).toHaveLength(0);
    expect((await owner().query(`SELECT count(*)::int AS n FROM camp_test_sends`)).rows[0].n).toBe(
      0,
    );
  });

  it('sends the template with the variable resolved for a real contact of the audience, logs every number, and tracking stays off', async () => {
    const { w, d } = await ready('bwt-s1');
    lab.sent.length = 0;
    const a = number('1234');
    const b = number('9999');
    const res = await send(w, d.id, `${a}, ${b}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = wizardTestSendResponseSchema.parse(res.body);
    expect(out.renderedBody).toBe('Hi Aarav, our offer is live.');
    expect(out.results.map((r) => [r.to, r.status])).toEqual([
      [a, 'sent'],
      [b, 'failed'],
    ]);
    // The sandbox refused the second number on the spot, as Meta refuses a number it will not message.
    expect(out.results[1]).toMatchObject({ errorCode: '131030' });
    expect(lab.sent).toHaveLength(1);
    expect(JSON.stringify(lab.sent[0]!.components)).toContain('Aarav');
    expect(lab.sent[0]!.to).toBe(a.replace('+', ''));
    expect(lab.sent[0]!.clientReference).toMatch(/^camptest-/);
    // Never wrapped as a campaign link.
    expect(
      (
        await owner().query(`SELECT count(*)::int AS n FROM wa_link_clicks WHERE org_id = $1`, [
          w.t.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);

    const log = wizardTestLogSchema.parse(
      (await wiz(lab, w.t.admin).get(`/drafts/${d.id}/test-sends`)).body,
    );
    expect(log.data.map((r) => [r.to, r.status])).toEqual([
      [b, 'failed'],
      [a, 'sent'],
    ]);
  });

  it('is charged the way a normal send is: when delivery is reported, once per message, and the log shows the charge', async () => {
    const { w, d } = await ready('bwt-c1');
    const a = number('1234');
    await send(w, d.id, a);
    await lab.flush();
    const billing = lab.h.app.get(MessageBillingService, { strict: false });
    const events = (
      await owner().query(
        `SELECT aggregate_module AS m, payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
        [w.t.orgId, MESSAGE_DELIVERY_EVENT],
      )
    ).rows.map((x) => ({
      module: x.m as string,
      ...walletDeliveryReportedSchema.parse(x.payload),
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      module: 'campaigns',
      provider: 'waba',
      status: 'delivered',
      source: 'campaign',
      category: 'marketing',
      recipient: a,
    });

    const before = await balanceMinor(lab, w.t.orgId);
    const e = events[0]!;
    await billing.settleDelivered({
      orgId: w.t.orgId,
      provider: e.provider,
      providerMessageId: e.providerMessageId,
      recipient: e.recipient ?? null,
      category: e.category ?? null,
      source: e.source ?? null,
    });
    const after = await balanceMinor(lab, w.t.orgId);
    expect(after).toBeLessThan(before);
    await billing.settleDelivered({
      orgId: w.t.orgId,
      provider: e.provider,
      providerMessageId: e.providerMessageId,
      recipient: e.recipient ?? null,
      category: e.category ?? null,
      source: e.source ?? null,
    });
    expect(await balanceMinor(lab, w.t.orgId)).toBe(after);

    const log = wizardTestLogSchema.parse(
      (await wiz(lab, w.t.admin).get(`/drafts/${d.id}/test-sends`)).body,
    );
    expect(log.data[0]).toMatchObject({ status: 'delivered', chargedMinor: before - after });
  });

  it('a frequency-cap refusal of a test is shown on its log row, with the code, and is not charged', async () => {
    const { w, d } = await ready('bwt-f1');
    await send(w, d.id, number('1049'));
    await lab.flush();
    const log = wizardTestLogSchema.parse(
      (await wiz(lab, w.t.admin).get(`/drafts/${d.id}/test-sends`)).body,
    );
    expect(log.data[0]).toMatchObject({ status: 'failed', errorCode: '131049', chargedMinor: 0 });
    const e = (
      await owner().query(
        `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = $2`,
        [w.t.orgId, MESSAGE_DELIVERY_EVENT],
      )
    ).rows.map((x) => walletDeliveryReportedSchema.parse(x.payload));
    expect(e.map((x) => x.status)).toEqual(['failed']);
  });

  it('an empty wallet blocks the test (422 WALLET_EMPTY) before anything is sent or logged', async () => {
    const { w, d } = await ready('bwt-w1', 0);
    lab.sent.length = 0;
    const res = await send(w, d.id, number('1234'));
    expect(res.status).toBe(422);
    expect(problem(res).code).toBe('WALLET_EMPTY');
    expect(lab.sent).toHaveLength(0);
    expect(
      (
        await owner().query(`SELECT count(*)::int AS n FROM camp_test_sends WHERE org_id = $1`, [
          w.t.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('needs the template and every variable mapped first', async () => {
    const w = await world(lab, 'bwt-i1');
    await payPerMessage(lab, w.t, 5_000_000);
    const d = await makeDraft(lab, w, { name: 'x', templateId: w.template });
    const res = await send(w, d.id, number('1234'));
    expect(res.status).toBe(422);
    expect(problem(res)).toMatchObject({
      code: 'CAMP_WIZARD_INCOMPLETE',
      errors: [{ path: 'variables.body.1', message: 'variable_unmapped' }],
    });
  });
});

describe('BL-191: a test send is held, not denied, in the quiet hours', () => {
  /** 2030-10-15 16:00 UTC: 21:30 in India (quiet 21:00 to 09:00), 17:00 in London (open). */
  const EVENING = '2030-10-15T16:00:00Z';
  const MORNING = '2030-10-16T03:31:00Z';
  const OPENS = '2030-10-16T03:30:00.000Z';
  const INDIA = '+919876543210';
  const LONDON = '+442071838750';

  async function ready(label: string, category = 'marketing') {
    const w = await world(lab, label, { category });
    await payPerMessage(lab, w.t, 5_000_000);
    const ids = await people(lab, w.t, [{ name: 'Aarav Sharma' }]);
    await owner().query(`UPDATE contacts SET first_name = 'Aarav' WHERE uuid = $1`, [ids[0]]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g));
    await owner().query(
      `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end) VALUES ($1, true, '21:00', '09:00')`,
      [w.t.orgId],
    );
    return { w, d };
  }
  const send = (w: World, draftId: string, recipients: string) =>
    wiz(lab, w.t.admin).post('/test-send', { draftId, recipients });
  const release = (orgId: number, id: number) =>
    RequestContextStore.run(
      { requestId: 'test-release', orgId, actorType: 'system', actorId: null, userId: null },
      () => lab.h.app.get(WizardTestSendService, { strict: false }).release(orgId, id),
    );
  const row = async (id: number) =>
    (
      await owner().query(
        `SELECT status, held_until, held_reason, provider_message_id FROM camp_test_sends WHERE id = $1`,
        [id],
      )
    ).rows[0];

  it('sends the number that is awake, holds the one in its quiet hours, and says when', async () => {
    const { w, d } = await ready('bwt-q1');
    at(EVENING);
    lab.sent.length = 0;
    const res = await send(w, d.id, `${INDIA}, ${LONDON}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = wizardTestSendResponseSchema.parse(res.body);
    expect(out.results.map((r) => [r.to, r.status, r.heldUntil])).toEqual([
      [INDIA, 'held', OPENS],
      [LONDON, 'sent', null],
    ]);
    expect(lab.sent.map((m) => m.to)).toEqual([LONDON.replace('+', '')]);

    // The log says so too, and a job waits for the opening on the campaign queue.
    const log = wizardTestLogSchema.parse(
      (await wiz(lab, w.t.admin).get(`/drafts/${d.id}/test-sends`)).body,
    );
    expect(log.data.find((r) => r.to === INDIA)).toMatchObject({
      status: 'held',
      heldUntil: OPENS,
    });
    const held = (
      await owner().query(`SELECT id FROM camp_test_sends WHERE org_id = $1 AND status = 'held'`, [
        w.t.orgId,
      ])
    ).rows[0];
    const queue = lab.h.app.get<Queue>(getQueueToken(QUEUES.CAMPAIGN), { strict: false });
    const job = (await queue.getDelayed()).find(
      (j) => j.name === TEST_SEND_RELEASE_JOB && j.data.testSendId === Number(held.id),
    );
    expect(job, 'the release job').toBeDefined();
    expect(job!.opts.delay).toBeGreaterThan(11 * 3_600_000);
  });

  it('waits again when released too early, then sends at the opening and stops being held', async () => {
    const { w, d } = await ready('bwt-q2');
    at(EVENING);
    lab.sent.length = 0;
    await send(w, d.id, INDIA);
    const id = Number(
      (await owner().query(`SELECT id FROM camp_test_sends WHERE org_id = $1`, [w.t.orgId])).rows[0]
        .id,
    );

    expect(await release(w.t.orgId, id)).toBe('held');
    expect(lab.sent).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: 'held' });

    at(MORNING);
    expect(await release(w.t.orgId, id)).toBe('sent');
    expect(lab.sent.map((m) => m.to)).toEqual([INDIA.replace('+', '')]);
    expect(lab.sent[0]!.clientReference).toMatch(/^camptest-/);
    const after = await row(id);
    expect(after).toMatchObject({ status: 'sent', held_until: null, held_reason: null });
    expect(after.provider_message_id).toBeTruthy();
    // Released twice: the second finds nothing held and sends nothing more.
    expect(await release(w.t.orgId, id)).toBe('skipped');
    expect(lab.sent).toHaveLength(1);
  });

  it('a utility template is never held', async () => {
    const { w, d } = await ready('bwt-q3', 'utility');
    at(EVENING);
    lab.sent.length = 0;
    const out = wizardTestSendResponseSchema.parse((await send(w, d.id, INDIA)).body);
    expect(out.results[0]).toMatchObject({ status: 'sent', heldUntil: null });
    expect(lab.sent).toHaveLength(1);
  });
});
