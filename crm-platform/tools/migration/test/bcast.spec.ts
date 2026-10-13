import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  MIN_FAILED_SEND_ATTEMPTS,
  resolveBroadcast,
  type BroadcastOptions,
} from '../broadcast/config';
import {
  campaignSchedule,
  campaignStatus,
  deriveStatus,
  errorParts,
  moneyString,
} from '../broadcast/rules';
import { runClient, type RunOptions } from '../load/run';
import { reconcile } from '../reconcile';
import { resolve } from '../registry';
import { STEPS } from '../transform';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';
import { acmeBcast, bulkBcast, CAMP_C1_BID, ERR_131049, globexBcast } from './bcast-fixtures';
import { O } from './fixtures';

/** contacts.legacy_id is the Mongo _id hex of the contact document */
const hex = (n: number): string => (O(n) as { $oid: string }).$oid;

const OWNER = 'owner@example.test';

const opts = (
  d: Dumps,
  db: TestDb,
  client: 'acme' | 'globex',
  extra: Partial<RunOptions> = {},
): RunOptions =>
  runOpts(d, db, client, {
    org: { name: client, slug: client, ownerEmail: client === 'acme' ? OWNER : null },
    allowNoOwner: client === 'globex',
    ...extra,
  });

const check = (
  d: Dumps,
  db: TestDb,
  client: 'acme' | 'globex',
  broadcast?: BroadcastOptions,
  allowExtraRows = false,
) =>
  reconcile({
    source: d.source,
    dumpsDir: d.dir,
    client,
    targetUrl: db.workerUrl,
    sampleSize: 1000,
    broadcast,
    allowExtraRows,
  });

const rows = async (db: TestDb, text: string): Promise<Array<Record<string, any>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, any>>);
const one = async (db: TestDb, text: string): Promise<number> =>
  Number((await rows(db, text))[0]!.n);

/** Content of the two tables that does not depend on ids or on when the run happened: two clean runs must agree on it. */
async function snapshot(db: TestDb): Promise<string> {
  const c = await rows(
    db,
    `SELECT c.uuid::text AS uuid, u.email::text AS author, to_jsonb(c) - 'id' - 'org_id' - 'uuid' - 'created_by' AS rest
     FROM wpcampaigns c LEFT JOIN users u ON u.org_id = c.org_id AND u.id = c.created_by ORDER BY c.uuid`,
  );
  const r = await rows(
    db,
    `SELECT r.uuid::text AS uuid, c.uuid::text AS campaign, ct.legacy_id AS contact,
            to_jsonb(r) - 'id' - 'org_id' - 'uuid' - 'campaign_id' - 'contact_id' AS rest
     FROM wp_campaign_contacts r JOIN wpcampaigns c ON c.org_id = r.org_id AND c.id = r.campaign_id
     LEFT JOIN contacts ct ON ct.org_id = r.org_id AND ct.id = r.contact_id ORDER BY r.uuid`,
  );
  return JSON.stringify({ c, r });
}

const TABLES = ['wpcampaigns', 'wp_campaign_contacts', 'migration.id_map', 'migration.quarantine'];
const totals = async (db: TestDb): Promise<Record<string, number>> =>
  Object.fromEntries(
    await Promise.all(
      TABLES.map(async (t) => [t, await one(db, `SELECT count(*)::int AS n FROM ${t}`)] as const),
    ),
  );

let dumps: Dumps;
let base: TestDb;
const dbs: TestDb[] = [];
const clone = async (label: string, from?: string): Promise<TestDb> => {
  const d = await cloneDb(label, from);
  dbs.push(d);
  return d;
};

beforeAll(async () => {
  const a = acmeBcast();
  const g = globexBcast();
  dumps = await customDumps({
    acme: {
      contact_list: a.contact_list,
      user: a.user,
      broadcasting: a.broadcasting,
      whatsapp_broadcasting_data: a.whatsapp_broadcasting_data,
    },
    globex: {
      contact_list: g.contact_list,
      broadcasting: g.broadcasting,
      whatsapp_broadcasting_data: g.whatsapp_broadcasting_data,
    },
  });
  base = await clone('bc-base');
  await runClient(opts(dumps, base, 'acme'));
  await runClient(opts(dumps, base, 'globex'));
}, 1_800_000);

afterAll(async () => {
  for (const d of dbs) await d.drop();
  dumps.cleanup();
});

describe('registry, configuration and the pure rules', () => {
  it('both collections are migrated by the broadcast steps, templates stay excluded, the order is campaigns before recipients', () => {
    expect(resolve('broadcasting')).toMatchObject({
      disposition: 'MIGRATE',
      handler: 'campaigns',
      targets: ['wpcampaigns'],
    });
    expect(resolve('whatsapp_broadcasting_data')).toMatchObject({
      disposition: 'MIGRATE',
      handler: 'recipients',
      targets: ['wp_campaign_contacts'],
    });
    expect(resolve('broadcast_templates').disposition).toBe('EXCLUDE');
    const order = STEPS.map((s) => s.handler);
    expect(order.indexOf('campaigns')).toBeLessThan(order.indexOf('recipients'));
    expect(order.indexOf('recipients')).toBeLessThan(order.indexOf('inbox'));
    expect(order.indexOf('contacts')).toBeLessThan(order.indexOf('campaigns'));
  });

  it('refuses a switch that would let the sweeper run an imported failed recipient, before anything is written', async () => {
    expect(() => resolveBroadcast({ failedSendAttempts: MIN_FAILED_SEND_ATTEMPTS - 1 })).toThrow(
      /BROADCAST_CONFIG/,
    );
    expect(() => resolveBroadcast({ nonTerminalStatus: 'scheduled' as 'failed' })).toThrow(
      /terminal/,
    );
    expect(resolveBroadcast()).toEqual({
      failedSendAttempts: 3,
      keepTestBroadcasts: false,
      nonTerminalStatus: 'cancelled',
    });
    const db = await clone('bc-cfg');
    await expect(
      runClient(opts(dumps, db, 'acme', { broadcast: { failedSendAttempts: 1 } })),
    ).rejects.toThrow(/BROADCAST_CONFIG/);
    expect(await one(db, 'SELECT count(*)::int AS n FROM organizations')).toBe(0);
  });

  it('derives the recipient status forward-only, with a failure that is not followed by a later step', () => {
    const d = (iso: string) => new Date(iso);
    const sd = (o: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      deriveStatus({ status: o, ...extra });
    expect(sd({ sent: d('2026-01-01T00:00:00Z') })).toMatchObject({ status: 'sent' });
    expect(sd({ sent: d('2026-01-01T00:00:00Z'), seen: d('2026-01-01T00:00:09Z') })).toMatchObject({
      status: 'read',
      deliveredAt: null,
    });
    expect(
      sd({ sent: d('2026-01-01T00:00:00Z'), replied: d('2026-01-01T00:01:00Z') }),
    ).toMatchObject({ status: 'responded' });
    const failed = sd({ sent: d('2026-01-01T00:00:00Z'), failed: d('2026-01-01T00:00:05Z') })!;
    expect(failed).toMatchObject({
      status: 'failed',
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      respondedAt: null,
    });
    const later = sd({
      sent: d('2026-01-01T00:00:00Z'),
      failed: d('2026-01-01T00:00:05Z'),
      delivered: d('2026-01-01T00:00:05Z'),
    })!;
    expect(later.status).toBe('delivered'); // equal time: the delivery wins
    expect(later.soft.map((s) => s.code)).toContain('STATUS_CONFLICT');
    expect(sd({ failed: d('2026-01-01T00:00:05Z') })).toMatchObject({ status: 'failed' });
    expect(sd({}, { 'status.sent': d('2026-01-02T00:00:00Z') })).toMatchObject({ status: 'sent' });
    expect(sd({})).toBeNull();
    expect(sd({ sent: 'not a date' })).toBeNull();
    expect(deriveStatus({ status: 'sent' })).toBeNull();
  });

  it('reads the error code, the status, the schedule and the money the way the spec says', () => {
    expect(errorParts(ERR_131049)).toMatchObject({ code: '131049' });
    expect(errorParts('131026 Message undeliverable').code).toBe('131026');
    expect(errorParts('Phone is not a WhatsApp user').code).toBeNull();
    expect(errorParts('12345678 digits too long').code).toBeNull();
    expect(errorParts(null)).toEqual({ message: null, code: null });
    const s = resolveBroadcast();
    expect(campaignStatus('Completed', s).status).toBe('completed');
    expect(campaignStatus('canceled', s)).toMatchObject({ status: 'cancelled', soft: null });
    expect(campaignStatus('running', s).soft?.code).toBe('NONTERMINAL_AT_MIGRATION');
    expect(campaignStatus('paused', s).status).toBe('cancelled');
    expect(campaignStatus('weird', s).soft?.code).toBe('UNKNOWN_STATUS');
    expect(campaignStatus(null, resolveBroadcast({ nonTerminalStatus: 'failed' }))).toMatchObject({
      status: 'failed',
    });
    // a zone-less string is UTC, whatever zone the machine runs in
    expect(
      campaignSchedule({ scheduled_now: false, scheduled_date: '2026-06-12T10:30:00' }),
    ).toMatchObject({ type: 'scheduled', date: '2026-06-12', time: '10:30:00', timezone: 'UTC' });
    expect(
      campaignSchedule({ scheduled_now: true, scheduled_date: '2026-06-12T10:30:00' }).type,
    ).toBe('now');
    expect(campaignSchedule({ scheduled_date: 'garbage' }).soft.map((x) => x.code)).toEqual([
      'BAD_DATE',
    ]);
    // money: exact decimal strings from mixed int / double
    expect(moneyString(4)).toBe('4');
    expect(moneyString(12.5)).toBe('12.5');
    expect(moneyString(0.1 + 0.2)).toBe('0.3');
    expect(moneyString(3.25)).toBe('3.25');
    expect(moneyString(Number.NaN)).toBeNull();
    expect(moneyString('7.10')).toBe('7.10');
  });
});

describe('the load', () => {
  it('reconcile passes for both clients: the equation holds and every independent check agrees', async () => {
    for (const client of ['acme', 'globex'] as const) {
      const r = await check(dumps, base, client);
      expect(r.alarms, client).toEqual([]);
      expect(r.integrity).toEqual([]);
      expect(r.ok).toBe(true);
    }
    const r = await check(dumps, base, 'acme');
    const row = (c: string) => r.collections.find((x) => x.collection === c)!;
    expect(row('broadcasting')).toMatchObject({
      read: 13,
      migrated: 9,
      quarantined: 2,
      excluded: 2,
      unaccounted: 0,
    });
    expect(row('whatsapp_broadcasting_data')).toMatchObject({
      read: 41,
      migrated: 26,
      quarantined: 7,
      excluded: 8,
      unaccounted: 0,
    });
    // the excluded rows are counted by reason
    expect(r.excludedByCode['whatsapp_broadcasting_data: NON_BROADCAST_SOURCE']).toBe(6);
    expect(r.excludedByCode['whatsapp_broadcasting_data: CAMPAIGN_EXCLUDED']).toBe(2);
    expect(r.excludedByCode['broadcasting: TEST_BROADCAST']).toBe(1);
    expect(r.excludedByCode['broadcasting: SOFT_DELETED']).toBe(1);
    // the NOT PRESENT list names the fields with no column, with counts
    const np = r.notPresent.droppedFields.join('\n');
    expect(np).toMatch(/NOT PRESENT \(broadcasts\): wpcampaigns: broadcast_template_name.*9 of 9/);
    expect(np).toMatch(/wpcampaigns: sender_number: 9 of 9/);
    expect(np).toMatch(/wp_campaign_contacts: amount \(money, credits step\): 26 of 26/);
    expect(np).toMatch(/wp_campaign_contacts: meta_template_id/);
    expect(np).toMatch(/wpcampaigns: retry_enabled = true.*1 of 9/);
    expect(np).toMatch(/rows of other sources with an amount.*6 of 6/);
  });

  it('puts every document in the right place with the right reason', async () => {
    const q = await rows(
      base,
      `SELECT collection, reason_code, count(*)::int AS n FROM migration.quarantine
       WHERE source_client = 'acme' AND collection IN ('broadcasting', 'whatsapp_broadcasting_data') AND position('#' in source_key) = 0
       GROUP BY 1, 2 ORDER BY 1, 2`,
    );
    expect(q).toEqual([
      { collection: 'broadcasting', reason_code: 'EMPTY_NAME', n: 1 },
      { collection: 'broadcasting', reason_code: 'UNSUPPORTED_TYPE', n: 1 },
      { collection: 'whatsapp_broadcasting_data', reason_code: 'CAMPAIGN_MISSING', n: 3 },
      { collection: 'whatsapp_broadcasting_data', reason_code: 'NO_PHONE', n: 1 },
      { collection: 'whatsapp_broadcasting_data', reason_code: 'NO_STATUS', n: 1 },
      { collection: 'whatsapp_broadcasting_data', reason_code: 'NUL_CHAR', n: 1 },
    ]);
    // a repeated primary key is quarantined under `<key>#dup2`, never silently skipped
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM migration.quarantine WHERE source_client = 'acme' AND collection = 'whatsapp_broadcasting_data' AND reason_code = 'DUPLICATE_KEY'`,
      ),
    ).toBe(1);
    // nothing of the non-broadcast sources is a recipient, and none of them is in id_map
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM wp_campaign_contacts WHERE whatsapp_message_id LIKE 'wamid.bc.auto%' OR whatsapp_message_id IN ('wamid.bc.inbox1', 'wamid.bc.test1', 'wamid.bc.nobid')`,
      ),
    ).toBe(0);
    expect(
      await one(
        base,
        `SELECT count(DISTINCT target_id)::int AS n FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'whatsapp_broadcasting_data'`,
      ),
    ).toBe(26);
  });

  it('writes campaigns in a terminal status with retry off, template NULL and the counters of their rows', async () => {
    const c = await rows(
      base,
      `SELECT c.campaign_name, c.status, c.provider, c.campaign_type, c.retry_enabled, c.template_id, c.device_id, c.wizard, c.schedule_type,
              to_char(c.send_date, 'YYYY-MM-DD') AS d, to_char(c.send_time, 'HH24:MI:SS') AS t, c.timezone, c.total_recipients,
              c.sent_count, c.delivered_count, c.read_count, c.responded_count, c.failed_count, u.email::text AS author,
              c.last_run_at, c.run_at, c.completed_at, c.updated_at, c.created_at
       FROM wpcampaigns c LEFT JOIN users u ON u.org_id = c.org_id AND u.id = c.created_by
       JOIN organizations o ON o.id = c.org_id WHERE o.slug = 'acme' ORDER BY c.campaign_name`,
    );
    const by = (n: string) => c.find((x) => x.campaign_name === n)!;
    expect(c.map((x) => x.campaign_name).sort()).toEqual(
      [
        'Archived one',
        'Cancelled one',
        'Diwali blast',
        'Failed run',
        'Ghost author',
        'Paused one',
        'Scheduled one',
        'Still running',
        'Weekend promo',
      ].sort(),
    );
    for (const x of c) {
      expect(['completed', 'failed', 'cancelled']).toContain(x.status);
      expect(x).toMatchObject({
        retry_enabled: false,
        template_id: null,
        device_id: null,
        wizard: null,
        provider: 'waba',
        campaign_type: 'template',
      });
    }
    expect(by('Diwali blast')).toMatchObject({
      status: 'completed',
      schedule_type: 'scheduled',
      d: '2026-05-15',
      t: '08:30:00',
      timezone: 'UTC',
      total_recipients: 40, // Waboo's audience, larger than the 18 rows of the log
      sent_count: 14,
      delivered_count: 12,
      read_count: 2,
      responded_count: 1,
      failed_count: 4,
      author: 'agent.one@example.test',
    });
    expect(new Date(by('Diwali blast').completed_at).toISOString()).toBe(
      '2026-05-15T09:00:00.000Z',
    );
    expect(new Date(by('Diwali blast').updated_at).toISOString()).toBe('2026-05-15T09:30:00.000Z'); // Waboo's own, not now()
    expect(by('Weekend promo')).toMatchObject({
      schedule_type: 'now',
      d: null,
      total_recipients: 5,
      sent_count: 3,
      delivered_count: 3,
    });
    expect(by('Still running')).toMatchObject({
      status: 'cancelled',
      completed_at: null,
      sent_count: 1,
    });
    expect(by('Paused one').status).toBe('cancelled');
    expect(by('Archived one').status).toBe('cancelled');
    expect(by('Failed run').status).toBe('failed');
    expect(by('Cancelled one').status).toBe('cancelled');
    // scheduled, zone-less string only: read as UTC, nothing was sent so there is no last_run_at
    expect(by('Scheduled one')).toMatchObject({
      status: 'cancelled',
      schedule_type: 'scheduled',
      d: '2026-12-24',
      t: '18:00:00',
      last_run_at: null,
    });
    expect(new Date(by('Scheduled one').run_at).toISOString()).toBe('2026-12-24T18:00:00.000Z');
    expect(by('Ghost author').author).toBeNull();
    // the soft issues and the fields with no column, in the quarantine log (money as exact strings)
    const soft = await rows(
      base,
      `SELECT split_part(source_key, '#', 2) AS code, count(*)::int AS n FROM migration.quarantine
       WHERE source_client = 'acme' AND collection = 'broadcasting' AND position('#' in source_key) > 0 GROUP BY 1 ORDER BY 1`,
    );
    const sc = Object.fromEntries(soft.map((x) => [x.code, x.n]));
    expect(sc).toMatchObject({
      TEMPLATE_UNLINKED: 9,
      SENDER_NUMBER: 9,
      COST_FIELDS: 9,
      NONTERMINAL_AT_MIGRATION: 3,
      UNKNOWN_STATUS: 1,
      PENDING_AT_MIGRATION: 1,
      UNRESOLVED_USER: 1,
      COUNTER_MISMATCH: 7,
    });
    const cost = await rows(
      base,
      `SELECT doc FROM migration.quarantine WHERE collection = 'broadcasting' AND source_key LIKE '%#COST_FIELDS' AND doc::text LIKE '%"refunded_amount": "4"%'`,
    );
    expect(cost[0]!.doc).toEqual({
      detail: { billable_amount: '12.5', refunded_amount: '4', reseller_amount: '3.25' },
    });
    const tpl = await rows(
      base,
      `SELECT doc FROM migration.quarantine WHERE source_key LIKE '%#TEMPLATE_UNLINKED' LIMIT 1`,
    );
    expect(tpl[0]!.doc.detail).toMatchObject({ name: 'diwali_greeting_v2', category: 'MARKETING' });
  });

  it('writes recipients with the right status, timestamps, contact and phone; a failed row carries no timestamp', async () => {
    const r = await rows(
      base,
      `SELECT r.whatsapp_message_id AS msg, r.status, r.sent_at, r.delivered_at, r.read_at, r.responded_at, r.error_message, r.error_code,
              r.send_attempts, r.retry_state, r.retry_count, r.phone_number, r.recipient_name, r.next_attempt_at, ct.legacy_id AS contact, c.campaign_name AS campaign,
              r.created_at, r.updated_at
       FROM wp_campaign_contacts r JOIN wpcampaigns c ON c.org_id = r.org_id AND c.id = r.campaign_id
       LEFT JOIN contacts ct ON ct.org_id = r.org_id AND ct.id = r.contact_id
       JOIN organizations o ON o.id = r.org_id WHERE o.slug = 'acme'`,
    );
    expect(r).toHaveLength(26);
    const m = (msg: string | null) => r.find((x) => x.msg === msg)!;
    const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);
    expect(m('wamid.bc.sent1')).toMatchObject({
      status: 'sent',
      delivered_at: null,
      send_attempts: 1,
      contact: hex(8001),
      campaign: 'Diwali blast',
      phone_number: '+919812345671',
    });
    expect(iso(m('wamid.bc.sent1').sent_at)).toBe('2026-05-15T09:00:00.000Z');
    expect(m('wamid.bc.delivered1')).toMatchObject({
      status: 'delivered',
      read_at: null,
      contact: hex(8002),
    }); // by ObjectId hex
    expect(m('wamid.bc.read1')).toMatchObject({ status: 'read', responded_at: null });
    expect(m('wamid.bc.replied1')).toMatchObject({
      status: 'responded',
      contact: hex(8003),
    }); // no contact id: the single holder of the number
    expect(iso(m('wamid.bc.replied1').responded_at)).toBe('2026-05-15T09:03:00.000Z');
    // failed: no timestamp, 131049 recorded, final (send_attempts 3), nothing scheduled
    const f = m(null);
    expect(f).toMatchObject({
      status: 'failed',
      sent_at: null,
      delivered_at: null,
      read_at: null,
      responded_at: null,
      error_code: '131049',
      send_attempts: 3,
      retry_state: null,
      next_attempt_at: null,
      recipient_name: 'Farah',
    });
    expect(f.error_message).toBe(ERR_131049);
    expect(m('wamid.bc.failed2')).toMatchObject({
      status: 'failed',
      error_code: null,
      sent_at: null,
    });
    expect(m('wamid.bc.retry')).toMatchObject({
      status: 'failed',
      error_code: '131026',
      retry_count: 2,
      retry_state: null,
    });
    // the conflicts
    expect(m('wamid.bc.conflict1')).toMatchObject({
      status: 'delivered',
      error_message: null,
      error_code: null,
    });
    expect(m('wamid.bc.conflict2')).toMatchObject({
      status: 'failed',
      delivered_at: null,
      error_message: 'bounced after delivery',
    });
    // the "status.sent" quirk
    expect(m('wamid.bc.dotted1')).toMatchObject({ status: 'sent' });
    expect(iso(m('wamid.bc.dotted1').sent_at)).toBe('2026-05-15T09:06:00.000Z');
    expect(m('wamid.bc.dotted2')).toMatchObject({ status: 'delivered' });
    // contacts: deleted at source, ghost, ambiguous: none; found by phone: one
    for (const id of ['wamid.bc.cdel', 'wamid.bc.cghost', 'wamid.bc.camb'])
      expect(m(id).contact, id).toBeNull();
    expect(m('wamid.bc.cphone')).toMatchObject({
      contact: hex(8003),
      recipient_name: null,
    });
    const soft = await rows(
      base,
      `SELECT split_part(source_key, '#', 2) AS code, count(*)::int AS n FROM migration.quarantine
       WHERE source_client = 'acme' AND collection = 'whatsapp_broadcasting_data' AND position('#' in source_key) > 0 GROUP BY 1`,
    );
    const sc = Object.fromEntries(soft.map((x) => [x.code, x.n]));
    expect(sc).toMatchObject({
      CONTACT_DELETED_AT_SOURCE: 1,
      CONTACT_AMBIGUOUS: 1,
      STATUS_CONFLICT: 2,
      INVALID_PHONE: 1,
      ERROR_DROPPED: 1,
    });
    expect(sc.CONTACT_BY_PHONE).toBeGreaterThanOrEqual(2);
    // phones: E.164, the raw digits when unreadable, and the `mobile` fallback
    expect(m('wamid.bc.badphone').phone_number).toBe('9812345699');
    expect(m('wamid.bc.mobile').phone_number).toBe('+919812345601');
    expect(m('wamid.bc.replied1').phone_number).toBe('+919812345673');
    // no amount, cost or template column exists on the table: the money is not copied anywhere
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM wp_campaign_contacts r WHERE r::text LIKE '%0.35%'`,
      ),
    ).toBe(0);
  });

  it('keeps two organizations apart even when the same phone number is a recipient of both', async () => {
    const g = await rows(
      base,
      `SELECT r.phone_number, ct.legacy_id AS contact FROM wp_campaign_contacts r
       JOIN organizations o ON o.id = r.org_id LEFT JOIN contacts ct ON ct.org_id = r.org_id AND ct.id = r.contact_id
       WHERE o.slug = 'globex' ORDER BY r.phone_number`,
    );
    expect(g).toEqual([
      { phone_number: '+919812345671', contact: hex(8801) },
      { phone_number: '+919812345672', contact: null },
      { phone_number: '+919812345673', contact: null },
    ]);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM wp_campaign_contacts r JOIN wpcampaigns c ON c.org_id = r.org_id AND c.id = r.campaign_id
         JOIN organizations o ON o.id = c.org_id WHERE o.slug = 'globex'`,
      ),
    ).toBe(3);
    const gc = await rows(
      base,
      `SELECT c.total_recipients, c.sent_count, c.delivered_count, c.failed_count FROM wpcampaigns c JOIN organizations o ON o.id = c.org_id WHERE o.slug = 'globex'`,
    );
    expect(gc).toEqual([
      { total_recipients: 3, sent_count: 2, delivered_count: 1, failed_count: 1 },
    ]);
  });
});

describe('an imported campaign never sends', () => {
  it('no query a scheduler, sweeper, resume or retry job runs finds a migrated row', async () => {
    const hits = async (text: string): Promise<number> =>
      one(base, `SELECT count(*)::int AS n FROM (${text}) x`);
    // campaign-sweeper.service.ts: due scheduled campaigns, stalled running ones, the pending reset
    expect(await hits(`SELECT id FROM wpcampaigns WHERE status = 'scheduled'`)).toBe(0);
    expect(await hits(`SELECT id FROM wpcampaigns WHERE status = 'running'`)).toBe(0);
    expect(
      await hits(`SELECT id FROM wp_campaign_contacts WHERE status IN ('queued', 'pending')`),
    ).toBe(0);
    // reconcileMetaBlocks: failed recipients with attempts left (the Meta 131049 error would reschedule the whole campaign)
    expect(
      await hits(
        `SELECT DISTINCT org_id, campaign_id FROM wp_campaign_contacts WHERE status = 'failed' AND send_attempts < 3 AND next_attempt_at IS NULL`,
      ),
    ).toBe(0);
    // wizard-retry.service.ts arm(): retry-enabled campaigns with a failed recipient that has no retry state yet, and runDue()
    expect(
      await hits(`SELECT r.id FROM wp_campaign_contacts r JOIN wpcampaigns c ON c.org_id = r.org_id AND c.id = r.campaign_id
                  WHERE c.retry_enabled AND c.status NOT IN ('cancelled') AND r.status = 'failed' AND r.retry_state IS NULL`),
    ).toBe(0);
    expect(await hits(`SELECT id FROM wp_campaign_contacts WHERE retry_state IS NOT NULL`)).toBe(0);
    expect(
      await hits(
        `SELECT id FROM wpcampaigns WHERE retry_enabled OR wizard IS NOT NULL OR series_id IS NOT NULL OR expires_at IS NOT NULL`,
      ),
    ).toBe(0);
    // the error that would be matched as a Meta frequency cap is really in the data, so the guard above is what protects it
    expect(
      await hits(
        `SELECT id FROM wp_campaign_contacts WHERE error_code = '131049' OR error_message ILIKE '%healthy ecosystem%'`,
      ),
    ).toBe(1);
  });

  it('writes no outbox event, notification or wallet row, no charge with money in it, and has no INSERT trigger to fire', async () => {
    // since the credits step the NON_BROADCAST rows of the billing log become inert usage charges (free, no credits, no wallet link):
    // the broadcast step itself still writes none, and none of them may move money
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM usage_charges WHERE status <> 'free' OR credits <> 0 OR revenue_minor <> 0 OR wallet_tx_id IS NOT NULL`,
      ),
    ).toBe(0);
    for (const t of [
      'event_outbox',
      'notifications',
      'wallet_transactions',
      'camp_retry_attempts',
      'camp_test_sends',
      'scheduled_messages',
      'audit_log',
    ] as const) {
      const exists = await rows(base, `SELECT to_regclass('public.${t}') IS NOT NULL AS ok`);
      if (exists[0]!.ok) expect(await one(base, `SELECT count(*)::int AS n FROM ${t}`), t).toBe(0);
    }
    const trg = await rows(
      base,
      `SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('wpcampaigns', 'wp_campaign_contacts') AND (t.tgtype & 4) <> 0`,
    );
    expect(trg).toEqual([]);
    // no row was ever UPDATEd (touch_row would have bumped row_version)
    expect(
      (await one(base, `SELECT count(*)::int AS n FROM wpcampaigns WHERE row_version <> 1`)) +
        (await one(
          base,
          `SELECT count(*)::int AS n FROM wp_campaign_contacts WHERE row_version <> 1`,
        )),
    ).toBe(0);
  });
});

describe('dry run, idempotency, resume', () => {
  it('a dry run writes nothing', async () => {
    const db = await clone('bc-dry');
    await runClient(opts(dumps, db, 'acme', { dryRun: true }));
    const t = await totals(db);
    expect(t).toEqual({
      wpcampaigns: 0,
      wp_campaign_contacts: 0,
      'migration.id_map': 0,
      'migration.quarantine': 0,
    });
    expect(await one(db, 'SELECT count(*)::int AS n FROM organizations')).toBe(0);
  });

  it('a second run loads nothing new, with and without --force', async () => {
    const db = await clone('bc-idem');
    await runClient(opts(dumps, db, 'acme'));
    const t1 = await totals(db);
    const s1 = await snapshot(db);
    await runClient(opts(dumps, db, 'acme'));
    await runClient(opts(dumps, db, 'acme', { force: true }));
    expect(await totals(db)).toEqual(t1);
    expect(await snapshot(db)).toBe(s1);
    const r = await check(dumps, db, 'acme');
    expect(r.alarms).toEqual([]);
  });

  it('a run killed in the middle of the recipients resumes to exactly the result of a clean run', async () => {
    const db = await clone('bc-resume');
    const clean = await clone('bc-resume-clean');
    await runClient(opts(dumps, clean, 'acme'));
    await expect(
      runClient(
        opts(dumps, db, 'acme', {
          afterBatch: ({ step, batch }) => {
            if (step === 'recipients' && batch === 2) throw new Error('simulated crash');
          },
        }),
      ),
    ).rejects.toThrow(/simulated crash/);
    const part = await one(db, 'SELECT count(*)::int AS n FROM wp_campaign_contacts');
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(26);
    // a crash inside a batch's transaction rolls that batch back as a whole
    const db2 = await clone('bc-resume-mid');
    await expect(
      runClient(
        opts(dumps, db2, 'acme', {
          midBatch: ({ step, batch }) => {
            if (step === 'recipients' && batch === 3) throw new Error('simulated crash');
          },
        }),
      ),
    ).rejects.toThrow(/simulated crash/);
    for (const d of [db, db2]) {
      await runClient(opts(dumps, d, 'acme'));
      expect(await snapshot(d)).toBe(await snapshot(clean));
      expect(await totals(d)).toEqual(await totals(clean));
      const r = await check(dumps, d, 'acme');
      expect(r.alarms).toEqual([]);
    }
  });
});

describe('the switches', () => {
  it('--keep-test-broadcasts loads the test campaign and its recipients; reconcile with other switches says so', async () => {
    const db = await clone('bc-flags');
    const flags: BroadcastOptions = {
      keepTestBroadcasts: true,
      nonTerminalStatus: 'failed',
      failedSendAttempts: 5,
    };
    await runClient(opts(dumps, db, 'acme', { broadcast: flags }));
    expect(
      await one(db, `SELECT count(*)::int AS n FROM wpcampaigns WHERE campaign_name = 'Test only'`),
    ).toBe(1);
    expect(
      await one(
        db,
        `SELECT count(*)::int AS n FROM wp_campaign_contacts WHERE whatsapp_message_id = 'wamid.bc.ctest'`,
      ),
    ).toBe(1);
    expect(
      await one(
        db,
        `SELECT count(*)::int AS n FROM wpcampaigns WHERE campaign_name = 'Still running' AND status = 'failed'`,
      ),
    ).toBe(1);
    expect(
      await one(
        db,
        `SELECT count(*)::int AS n FROM wp_campaign_contacts WHERE status = 'failed' AND send_attempts = 5`,
      ),
    ).toBe(4);
    // reconcile reads the switches the run recorded
    const r = await check(dumps, db, 'acme');
    expect(r.alarms).toEqual([]);
    // explicit, different switches: the target no longer matches
    const other = await check(dumps, db, 'acme', { keepTestBroadcasts: false });
    expect(other.ok).toBe(false);
    expect(other.warnings.join('\n')).toMatch(/BROADCAST: option keepTestBroadcasts differs/);
  });
});

describe('the verifier catches damage', () => {
  const mutations: Array<[string, string, RegExp]> = [
    [
      'delete a recipient',
      `DELETE FROM wp_campaign_contacts WHERE whatsapp_message_id = 'wamid.bc.delivered1'`,
      /TARGET_MISSING|COUNTER_MISMATCH/,
    ],
    [
      'change a recipient status',
      `UPDATE wp_campaign_contacts SET status = 'read' WHERE whatsapp_message_id = 'wamid.bc.delivered1'`,
      /ORACLE_MISMATCH.*status|FINGERPRINT_MISMATCH/,
    ],
    [
      'set sent_at on a failed recipient',
      `UPDATE wp_campaign_contacts SET sent_at = now() WHERE error_code = '131049'`,
      /FAILED_WITH_TIMESTAMP/,
    ],
    [
      'change a campaign counter',
      `UPDATE wpcampaigns SET sent_count = sent_count + 1 WHERE campaign_name = 'Diwali blast'`,
      /COUNTER_MISMATCH/,
    ],
    [
      'change total_recipients (the audience size)',
      `UPDATE wpcampaigns SET total_recipients = total_recipients + 7 WHERE campaign_name = 'Diwali blast'`,
      /ORACLE_MISMATCH.*total_recipients/,
    ],
    [
      'add an extra recipient',
      `INSERT INTO wp_campaign_contacts (org_id, campaign_id, status, phone_number) SELECT org_id, id, 'sent', '+10000000000' FROM wpcampaigns WHERE campaign_name = 'Diwali blast'`,
      /EXTRA_ROWS/,
    ],
    [
      'add an extra campaign',
      `INSERT INTO wpcampaigns (org_id, campaign_name, status) SELECT id, 'planted', 'completed' FROM organizations WHERE slug = 'acme'`,
      /EXTRA_ROWS/,
    ],
    [
      'flip a campaign to a schedulable state',
      `UPDATE wpcampaigns SET status = 'scheduled' WHERE campaign_name = 'Weekend promo'`,
      /SENDABLE_CAMPAIGN|ORACLE_MISMATCH.*status/,
    ],
    [
      'flip a campaign to running',
      `UPDATE wpcampaigns SET status = 'running' WHERE campaign_name = 'Diwali blast'`,
      /SENDABLE_CAMPAIGN/,
    ],
    [
      'switch retry on',
      `UPDATE wpcampaigns SET retry_enabled = true WHERE campaign_name = 'Diwali blast'`,
      /SENDABLE_CAMPAIGN|ORACLE_MISMATCH.*retry_enabled/,
    ],
    [
      'queue a recipient',
      `UPDATE wp_campaign_contacts SET status = 'queued' WHERE whatsapp_message_id = 'wamid.bc.sent1'`,
      /SENDABLE_RECIPIENT/,
    ],
    [
      'arm a retry',
      `UPDATE wp_campaign_contacts SET retry_state = 'scheduled', retry_next_at = now() WHERE error_code = '131049'`,
      /SENDABLE_RECIPIENT/,
    ],
    [
      'let the sweeper retry a failed recipient (send_attempts below 3)',
      `UPDATE wp_campaign_contacts SET send_attempts = 0 WHERE error_code = '131049'`,
      /SENDABLE_RECIPIENT|ORACLE_MISMATCH.*send_attempts/,
    ],
    [
      'change a phone number',
      `UPDATE wp_campaign_contacts SET phone_number = '+10000000001' WHERE whatsapp_message_id = 'wamid.bc.sent1'`,
      /ORACLE_MISMATCH.*phone_number/,
    ],
    [
      'detach a contact',
      `UPDATE wp_campaign_contacts SET contact_id = NULL WHERE whatsapp_message_id = 'wamid.bc.sent1'`,
      /ORACLE_MISMATCH.*contact_id/,
    ],
    [
      'move a recipient to another campaign',
      `UPDATE wp_campaign_contacts SET campaign_id = (SELECT id FROM wpcampaigns WHERE campaign_name = 'Weekend promo') WHERE whatsapp_message_id = 'wamid.bc.sent1'`,
      /ORACLE_MISMATCH.*campaign|COUNTER_MISMATCH/,
    ],
    [
      'change an error code',
      `UPDATE wp_campaign_contacts SET error_code = '1' WHERE error_code = '131049'`,
      /ORACLE_MISMATCH.*error_code/,
    ],
    [
      'link a template',
      `UPDATE wpcampaigns SET template_id = NULL, custom_message = 'hello' WHERE campaign_name = 'Diwali blast'`,
      /ORACLE_MISMATCH.*default custom_message/,
    ],
    [
      'delete a campaign (its recipients go with it)',
      `DELETE FROM wpcampaigns WHERE campaign_name = 'Failed run'`,
      /TARGET_MISSING/,
    ],
    [
      'rename a campaign',
      `UPDATE wpcampaigns SET campaign_name = 'Renamed' WHERE campaign_name = 'Failed run'`,
      /ORACLE_MISMATCH.*campaign_name/,
    ],
    [
      'change the money kept as text in the quarantine log',
      `UPDATE migration.quarantine SET doc = jsonb_set(doc, '{detail,refunded_amount}', '"99"') WHERE source_key LIKE '%#COST_FIELDS' AND doc::text LIKE '%"4"%'`,
      /QUARANTINE_CHANGED/,
    ],
    [
      'delete the soft-issue log of a campaign',
      `DELETE FROM migration.quarantine WHERE collection = 'broadcasting' AND source_key LIKE '%#TEMPLATE_UNLINKED' AND ctid = (SELECT ctid FROM migration.quarantine WHERE collection = 'broadcasting' AND source_key LIKE '%#TEMPLATE_UNLINKED' LIMIT 1)`,
      /QUARANTINE_CHANGED|no TEMPLATE_UNLINKED row/,
    ],
    [
      'delete an id_map row',
      `DELETE FROM migration.id_map WHERE source_collection = 'whatsapp_broadcasting_data' AND source_key = (SELECT source_key FROM migration.id_map WHERE source_collection = 'whatsapp_broadcasting_data' LIMIT 1)`,
      /IDMAP_MISSING|IDMAP_EXTRA|NOT_LOADED/,
    ],
    [
      'add an outbox row',
      `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload) SELECT id, 'campaigns', 1, 'campaign.completed', '{}' FROM organizations WHERE slug = 'acme'`,
      /EXTRA_ROWS.*event_outbox/,
    ],
    [
      'add a retry attempt',
      `INSERT INTO camp_retry_attempts (org_id, campaign_id, recipient_id, attempt_no, scheduled_for, outcome) SELECT r.org_id, r.campaign_id, r.id, 1, now(), 'sent' FROM wp_campaign_contacts r LIMIT 1`,
      /EXTRA_ROWS/,
    ],
  ];
  it.each(mutations)('%s', async (name, statement, expected) => {
    const db = await clone('bc-dmg', base.name);
    try {
      await asOwner(db, (d) => d.execute(sql.raw(statement)));
      const r = await check(dumps, db, 'acme');
      if (process.env.BCAST_DEBUG)
        console.log(
          `DAMAGE ${name}: ${[...r.alarms, ...r.integrity]
            .map((x) => x.slice(0, 110))
            .join(' | ')
            .slice(0, 600)}`,
        );
      expect(r.ok, name).toBe(false);
      expect(r.alarms.join('\n') + r.integrity.join('\n'), name).toMatch(expected);
    } finally {
      await db.drop();
      dbs.splice(dbs.indexOf(db), 1);
    }
  });
  it('the untouched copy still passes', async () => {
    const db = await clone('bc-ok', base.name);
    const r = await check(dumps, db, 'acme');
    expect(r.alarms).toEqual([]);
  });
});

describe('after cutover (--allow-extra-rows)', () => {
  it('live campaigns, sends and recounts are not an error, a lost or altered migrated recipient still is', async () => {
    const db = await clone('bc-live', base.name);
    await asOwner(db, async (d) => {
      await d.execute(
        sql.raw(
          `INSERT INTO wpcampaigns (org_id, campaign_name, status, schedule_type) SELECT id, 'Live campaign', 'running', 'now' FROM organizations WHERE slug = 'acme'`,
        ),
      );
      await d.execute(
        sql.raw(
          `INSERT INTO wp_campaign_contacts (org_id, campaign_id, status, phone_number) SELECT org_id, id, 'queued', '+10000000002' FROM wpcampaigns WHERE campaign_name = 'Live campaign'`,
        ),
      );
      await d.execute(
        sql.raw(
          `UPDATE wpcampaigns SET sent_count = sent_count + 5, status = 'completed' WHERE campaign_name = 'Diwali blast'`,
        ),
      );
      await d.execute(
        sql.raw(
          `UPDATE wp_campaign_contacts SET read_at = now(), status = 'read' WHERE whatsapp_message_id = 'wamid.bc.delivered1'`,
        ),
      );
    });
    expect((await check(dumps, db, 'acme')).ok).toBe(false);
    const live = await check(dumps, db, 'acme', undefined, true);
    expect(live.alarms).toEqual([]);
    await asOwner(db, (d) =>
      d.execute(
        sql.raw(`DELETE FROM wp_campaign_contacts WHERE whatsapp_message_id = 'wamid.bc.sent1'`),
      ),
    );
    const lost = await check(dumps, db, 'acme', undefined, true);
    expect(lost.ok).toBe(false);
    expect(lost.alarms.join('\n')).toMatch(/TARGET_MISSING/);
  });
});

describe('volume', () => {
  it('loads 20,000 delivery-log rows (14,000 recipients, 6,000 other sources) in batches and verifies them', async () => {
    const b = bulkBcast(10, 1400, 6000);
    const big = await customDumps({ acme: { contact_list: [], ...b } });
    const db = await clone('bc-vol');
    try {
      const t0 = Date.now();
      await runClient(
        runOpts(big, db, 'acme', {
          org: { name: 'acme', slug: 'acme' },
          batchSize: 1000,
          allowNoOwner: true,
        }),
      );
      const loadMs = Date.now() - t0;
      expect(await one(db, 'SELECT count(*)::int AS n FROM wp_campaign_contacts')).toBe(14_000);
      expect(await one(db, 'SELECT count(*)::int AS n FROM wpcampaigns')).toBe(10);
      expect(
        await one(
          db,
          `SELECT count(*)::int AS n FROM wp_campaign_contacts WHERE status = 'failed' AND (sent_at IS NOT NULL OR delivered_at IS NOT NULL)`,
        ),
      ).toBe(0);
      const t1 = Date.now();
      const r = await reconcile({
        source: big.source,
        dumpsDir: big.dir,
        client: 'acme',
        targetUrl: db.workerUrl,
      });
      const verifyMs = Date.now() - t1;
      console.log(
        `VOLUME 20,000 delivery-log rows (14,000 recipients, 6,000 excluded): load ${loadMs} ms, reconcile ${verifyMs} ms, alarms ${r.alarms.length}`,
      );
      expect(r.alarms.slice(0, 5)).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.excludedByCode['whatsapp_broadcasting_data: NON_BROADCAST_SOURCE']).toBe(6000);
      const t2 = Date.now();
      await runClient(
        runOpts(big, db, 'acme', {
          org: { name: 'acme', slug: 'acme' },
          batchSize: 1000,
          allowNoOwner: true,
        }),
      );
      console.log(`VOLUME re-run (nothing to do): ${Date.now() - t2} ms`);
      expect(await one(db, 'SELECT count(*)::int AS n FROM wp_campaign_contacts')).toBe(14_000);
    } finally {
      big.cleanup();
    }
  }, 1_800_000);
});

void CAMP_C1_BID;
