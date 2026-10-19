import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type {
  LeadPullProvider,
  LeadPullRequest,
  LeadPullResult,
} from '../../../src/modules/leads/lead-pull.port';
import { LeadPullRegistry } from '../../../src/modules/leads/lead-pull.registry';
import { LeadRetentionSweepService } from '../../../src/modules/leads/lead-retention-sweep.service';
import { LeadSyncRunsRepository } from '../../../src/modules/leads/lead-sync-runs.repository';
import { LeadSyncService } from '../../../src/modules/leads/lead-sync.service';
import {
  LEAD_MANAGE,
  LEAD_READ,
  LeadsApi,
  startHarness,
  type CreatedSource,
  type Harness,
  type Tenant,
} from './support';

/**
 * The lead inbox (BL-014, L-17, L-18) against a real Postgres and Redis: the cross-source list and its filters, the masked payload and
 * its audit, retry of one and of many (idempotent), and the sync and backfill of a source that can be pulled, with the limits that
 * keep a source from being hammered. The pull itself is a recorder registered as a provider: what the marketplace's provider does
 * with a real portal is its own unit spec.
 */
let h: Harness;
let api: LeadsApi;
let sync: LeadSyncService;
let registry: LeadPullRegistry;

const pulls: LeadPullRequest[] = [];
let behave: (req: LeadPullRequest) => Promise<LeadPullResult> = async (req) => {
  const progress = {
    fetched: 3,
    accepted: 2,
    duplicates: 1,
    failed: 0,
    windowsDone: 1,
    windowsTotal: 1,
  };
  await req.progress(progress);
  return { status: 'ok', progress };
};

const fake: LeadPullProvider = {
  name: 'fake',
  capabilities: async (_org, s) =>
    s.externalRef?.startsWith('fake-')
      ? {
          sync: true,
          backfill: s.externalRef === 'fake-both',
          minIntervalSeconds: 5,
          maxBackfillSeconds: 30 * 86_400,
        }
      : null,
  pull: async (req) => {
    pulls.push(req);
    return behave(req);
  },
};

beforeAll(async () => {
  h = await startHarness();
  api = new LeadsApi(h);
  sync = h.app.get(LeadSyncService, { strict: false });
  registry = h.app.get(LeadPullRegistry, { strict: false });
  registry.register(fake);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const key = () => ({ 'Idempotency-Key': randomUUID() });
const post = (token: string, path: string, body: unknown = {}) =>
  api
    .as(token)
    .post(path)
    .set(key())
    .send(body as object);

async function connector(t: Tenant, name: string, ref: string): Promise<string> {
  const res = await h.owner.query(
    `INSERT INTO lead_sources (org_id, kind, name, external_ref) VALUES ($1, 'connector', $2, $3) RETURNING uuid`,
    [t.orgId, name, ref],
  );
  return res.rows[0].uuid as string;
}

describe('the list and its filters', () => {
  let t: Tenant;
  let a: CreatedSource;
  let b: CreatedSource;
  beforeAll(async () => {
    t = await api.signup('inbox');
    a = await api.source(t.admin, {
      name: 'Alpha',
      externalIdPath: 'id',
      defaults: { countryCode: '91' },
    });
    b = await api.source(t.admin, { name: 'Beta', externalIdPath: 'id' });
    await api.hook(a.hookPath, {
      id: 'a-1',
      name: 'Ada One',
      phone: '98000 41001',
      email: 'ada1@example.test',
    });
    await api.hook(a.hookPath, { id: 'a-2', name: 'No Contact' });
    await api.hook(b.hookPath, { id: 'b-1', name: 'Bad Phone', phone: '12345' });
    await api.hook(b.hookPath, { id: 'b-2', name: 'Bea Two', email: 'bea2@example.test' });
    await api.as(t.admin).post(`/v2/lead-sources/${a.id}/test`).send({});
  });

  it('lists every source newest first with the source named, and no payload', async () => {
    const res = await api.as(t.admin).get('/v2/lead-inbox?limit=100');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.data as Array<Record<string, unknown>>;
    expect(items).toHaveLength(5);
    expect(new Set(items.map((i) => i.sourceName))).toEqual(new Set(['Alpha', 'Beta']));
    const times = items.map((i) => String(i.receivedAt));
    expect([...times].sort().reverse()).toEqual(times);
    expect(JSON.stringify(res.body)).not.toContain('payload"');
    expect(JSON.stringify(res.body)).not.toContain('example.test');
  });

  it('narrows by status, source, reason, test leads and the start of the sender id', async () => {
    const attention = await api.as(t.admin).get('/v2/lead-inbox?status=attention');
    expect(attention.body.data.map((i: { status: string }) => i.status).sort()).toEqual([
      'needs_review',
      'needs_review',
    ]);
    expect(attention.body.data.every((i: { retryable: boolean }) => i.retryable)).toBe(true);

    const beta = await api.as(t.admin).get(`/v2/lead-inbox?sourceId=${b.id}`);
    expect(beta.body.data).toHaveLength(2);
    const reason = await api.as(t.admin).get('/v2/lead-inbox?reason=invalid_phone');
    expect(reason.body.data).toHaveLength(1);
    expect(reason.body.data[0].sourceName).toBe('Beta');

    const tests = await api.as(t.admin).get('/v2/lead-inbox?isTest=true');
    expect(tests.body.data).toHaveLength(1);
    expect((await api.as(t.admin).get('/v2/lead-inbox?isTest=false')).body.data).toHaveLength(4);

    const prefix = await api.as(t.admin).get('/v2/lead-inbox?q=a-');
    expect(prefix.body.data.map((i: { externalId: string }) => i.externalId).sort()).toEqual([
      'a-1',
      'a-2',
    ]);
    // a wildcard typed by a person is a character, not a pattern
    expect((await api.as(t.admin).get('/v2/lead-inbox?q=%25')).body.data).toHaveLength(0);
  });

  it('narrows by the time received', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (await api.as(t.admin).get(`/v2/lead-inbox?from=${encodeURIComponent(future)}`)).body.data,
    ).toHaveLength(0);
    expect(
      (await api.as(t.admin).get(`/v2/lead-inbox?to=${encodeURIComponent(future)}`)).body.data,
    ).toHaveLength(5);
    await h.owner.query(
      `UPDATE lead_events SET received_at = now() - interval '40 days' WHERE org_id = $1 AND external_id = 'a-1'`,
      [t.orgId],
    );
    const to = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const old = await api.as(t.admin).get(`/v2/lead-inbox?to=${encodeURIComponent(to)}`);
    expect(old.body.data.map((i: { externalId: string }) => i.externalId)).toEqual(['a-1']);
  });

  it('pages without repeating or losing a lead', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const res = await api
        .as(t.admin)
        .get(`/v2/lead-inbox?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((x: { id: string }) => x.id));
      if (!res.body.page.hasMore) break;
      cursor = res.body.page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('counts per status over a window, and the leads that wait', async () => {
    const res = await api.as(t.admin).get('/v2/lead-inbox/summary');
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ needs_review: 2, created: 2, failed: 0 });
    expect(res.body.attention).toBe(2);
    // the lead received 40 days ago is outside the default 30-day window
    expect(res.body.total).toBe(4);
    const all = await api
      .as(t.admin)
      .get(
        `/v2/lead-inbox/summary?from=${encodeURIComponent(new Date(Date.now() - 90 * 86_400_000).toISOString())}`,
      );
    expect(all.body.total).toBe(5);
  });

  it('a reader can look but not open a payload, retry, or pull; a member with no key sees nothing', async () => {
    const reader = await api.member(t, 'inboxreader', LEAD_READ);
    const [ev] = await api.leadEvents(t.orgId, a.id);
    expect((await api.as(reader.token).get('/v2/lead-inbox')).status).toBe(200);
    expect((await api.as(reader.token).get('/v2/lead-inbox/summary')).status).toBe(200);
    expect((await api.as(reader.token).get(`/v2/lead-inbox/${ev!.uuid}`)).status).toBe(403);
    expect((await post(reader.token, `/v2/lead-inbox/${ev!.uuid}/retry`)).status).toBe(403);
    expect(
      (await post(reader.token, '/v2/lead-inbox/retry', { eventIds: [ev!.uuid] })).status,
    ).toBe(403);
    expect((await post(reader.token, `/v2/lead-inbox/sources/${a.id}/sync`)).status).toBe(403);
    expect(
      (
        await post(reader.token, '/v2/lead-inbox/backfill', {
          from: new Date(Date.now() - 86_400_000).toISOString(),
          to: new Date().toISOString(),
        })
      ).status,
    ).toBe(403);
    const nobody = await api.member(t, 'inboxnobody', []);
    expect((await api.as(nobody.token).get('/v2/lead-inbox')).status).toBe(403);
  });

  it("another workspace's leads are not in the list and cannot be opened or retried", async () => {
    const other = await api.signup('inboxother');
    expect((await api.as(other.admin).get('/v2/lead-inbox')).body.data).toHaveLength(0);
    const [ev] = await api.leadEvents(t.orgId, a.id);
    expect((await api.as(other.admin).get(`/v2/lead-inbox/${ev!.uuid}`)).status).toBe(404);
    expect((await post(other.admin, `/v2/lead-inbox/${ev!.uuid}/retry`)).status).toBe(404);
    const bulk = await post(other.admin, '/v2/lead-inbox/retry', { eventIds: [ev!.uuid] });
    expect(bulk.body.results).toEqual([{ id: ev!.uuid, outcome: 'not_found', status: null }]);
  });
});

describe('the masked payload', () => {
  let t: Tenant;
  let src: CreatedSource;
  let eventId: string;
  beforeAll(async () => {
    t = await api.signup('inboxmask');
    src = await api.source(t.admin, {
      name: 'Masked',
      externalIdPath: 'id',
      defaults: { countryCode: '91' },
    });
    await api.hook(src.hookPath, {
      id: 'm-1',
      name: 'Ada Lovelace',
      phone: '+919876543210',
      email: 'ada@example.test',
      notes: 'call after 5',
      api_key: 'secret-key-1',
      field_data: [{ name: 'phone_number', values: ['+919812345678'] }],
    });
    eventId = (await api.leadEvents(t.orgId, src.id))[0]!.uuid;
  });

  it('shows the payload with phone, email, name and free text masked and the secret redacted, and says so', async () => {
    const res = await api.as(t.admin).get(`/v2/lead-inbox/${eventId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.payloadMasked).toBe(true);
    const text = JSON.stringify(res.body.payload);
    for (const secret of [
      '9876543210',
      '9812345678',
      'ada@example.test',
      'Ada Lovelace',
      'call after 5',
      'secret-key-1',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain('+91 ******210');
    expect(text).toContain('a***@example.test');
    expect(text).toContain('[REDACTED]');
    // the shape is kept so a mapping can still be read from it
    expect(text).toContain('phone_number');
  });

  it('writes an audit row for opening it, as a read', async () => {
    const rows = await api.rows(
      t.orgId,
      `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'lead_events' AND action = 'read'`,
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain('example.test');
  });

  it('a payload past its retention is gone: null, and not retryable', async () => {
    await h.owner.query(
      `UPDATE lead_events SET payload = NULL, payload_purged_at = now() WHERE org_id = $1`,
      [t.orgId],
    );
    const res = await api.as(t.admin).get(`/v2/lead-inbox/${eventId}`);
    expect(res.body.payload).toBeNull();
    expect(res.body.payloadMasked).toBe(false);
    expect(res.body.hasPayload).toBe(false);
    expect(res.body.retryable).toBe(false);
  });
});

describe('retry, one and many', () => {
  let t: Tenant;
  let src: CreatedSource;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    t = await api.signup('inboxretry');
    // no default country code: a local number cannot be read
    src = await api.source(t.admin, { name: 'Retry source', externalIdPath: 'id' });
    await api.hook(src.hookPath, { id: 'r-1', name: 'One', phone: '98000 51001' });
    await api.hook(src.hookPath, { id: 'r-2', name: 'Two', phone: '98000 51002' });
    await api.hook(src.hookPath, { id: 'r-3', name: 'Three', phone: '+919800051003' });
    for (const e of await api.leadEvents(t.orgId, src.id)) ids[e.external_id] = e.uuid;
  });

  const status = async (id: string) =>
    (await api.as(t.admin).get(`/v2/lead-inbox`)).body.data.find((x: { id: string }) => x.id === id)
      .status;

  it('retries one lead after the settings were fixed, under the current settings', async () => {
    expect(await status(ids['r-1']!)).toBe('needs_review');
    const bad = await post(t.admin, `/v2/lead-inbox/${ids['r-3']!}/retry`);
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('LEAD_EVENT_NOT_RETRYABLE');

    const cur = await api.as(t.admin).get(`/v2/lead-sources/${src.id}`);
    const fix = await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${src.id}`)
      .send({
        rowVersion: cur.body.rowVersion,
        defaults: { ...cur.body.defaults, countryCode: '91' },
      });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);

    const res = await post(t.admin, `/v2/lead-inbox/${ids['r-1']!}/retry`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('created');
    expect(res.body.retryable).toBe(false);
    expect(await api.contactsWithPhone(t.orgId, '+919800051001')).toHaveLength(1);
  });

  it('retries many, reports each lead, and a second run of the same list writes nothing', async () => {
    const unknown = randomUUID();
    const first = await post(t.admin, '/v2/lead-inbox/retry', {
      eventIds: [ids['r-2']!, ids['r-3']!, unknown],
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.results).toEqual([
      { id: ids['r-2'], outcome: 'retried', status: 'created' },
      { id: ids['r-3'], outcome: 'not_retryable', status: null },
      { id: unknown, outcome: 'not_found', status: null },
    ]);
    expect(first.body).toMatchObject({ retried: 1, skipped: 2 });

    const before = await api.rows(
      t.orgId,
      `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`,
    );
    const again = await post(t.admin, '/v2/lead-inbox/retry', {
      eventIds: [ids['r-1']!, ids['r-2']!],
    });
    expect(again.body.results.map((r: { outcome: string }) => r.outcome)).toEqual([
      'not_retryable',
      'not_retryable',
    ]);
    const after = await api.rows(
      t.orgId,
      `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`,
    );
    expect(after).toEqual(before);
    const attempts = await api.leadEvents(t.orgId, src.id);
    expect(attempts.find((e) => e.external_id === 'r-2')!.attempts).toBe(2);
  });

  it('refuses a list that is empty, too long or repeats a lead, and a source that is paused', async () => {
    expect((await post(t.admin, '/v2/lead-inbox/retry', { eventIds: [] })).status).toBe(422);
    expect(
      (
        await post(t.admin, '/v2/lead-inbox/retry', {
          eventIds: Array.from({ length: 101 }, () => randomUUID()),
        })
      ).status,
    ).toBe(422);
    const dup = randomUUID();
    expect((await post(t.admin, '/v2/lead-inbox/retry', { eventIds: [dup, dup] })).status).toBe(
      422,
    );

    const paused = await api.source(t.admin, { name: 'Paused one', externalIdPath: 'id' });
    await api.hook(paused.hookPath, { id: 'p-1', name: 'Nobody' });
    const [ev] = await api.leadEvents(t.orgId, paused.id);
    const cur = await api.as(t.admin).get(`/v2/lead-sources/${paused.id}`);
    await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${paused.id}`)
      .send({ rowVersion: cur.body.rowVersion, status: 'paused' });
    const res = await post(t.admin, '/v2/lead-inbox/retry', { eventIds: [ev!.uuid] });
    expect(res.body.results[0].outcome).toBe('source_paused');
    const listed = (await api.as(t.admin).get(`/v2/lead-inbox?sourceId=${paused.id}`)).body.data[0];
    expect(listed.retryable).toBe(false);
  });
});

describe('sync now and backfill', () => {
  let t: Tenant;
  let both: string;
  let syncOnly: string;
  let hook: CreatedSource;
  beforeAll(async () => {
    t = await api.signup('inboxsync');
    both = await connector(t, 'Portal both', 'fake-both');
    syncOnly = await connector(t, 'Portal sync', 'fake-sync');
    hook = await api.source(t.admin, { name: 'A webhook' });
  });

  it('lists only the sources that can be pulled, with what each can do', async () => {
    const res = await api.as(t.admin).get('/v2/lead-inbox/sources');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.sourceName).sort()).toEqual(['Portal both', 'Portal sync']);
    const bothRow = rows.find((r) => r.sourceId === both)!;
    expect(bothRow).toMatchObject({
      canSync: true,
      canBackfill: true,
      minIntervalSeconds: 60,
      maxBackfillDays: 30,
      nextSyncAt: null,
      activeRun: null,
      lastRun: null,
    });
    expect(rows.find((r) => r.sourceId === syncOnly)).toMatchObject({
      canBackfill: false,
      maxBackfillDays: null,
    });
  });

  it('a webhook cannot be pulled: nothing to sync', async () => {
    const res = await post(t.admin, `/v2/lead-inbox/sources/${hook.id}/sync`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LEAD_SYNC_NOT_SUPPORTED');
  });

  it('sync now queues one run, audited; a second ask while it is open is refused; the worker finishes it with its counts', async () => {
    pulls.length = 0;
    const res = await post(t.admin, `/v2/lead-inbox/sources/${syncOnly}/sync`);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({
      kind: 'sync',
      status: 'queued',
      sourceName: 'Portal sync',
      rangeFrom: null,
    });

    const second = await post(t.admin, `/v2/lead-inbox/sources/${syncOnly}/sync`);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('LEAD_SYNC_IN_PROGRESS');

    const [run] = await api.rows(
      t.orgId,
      `SELECT id, requested_by FROM lead_sync_runs WHERE org_id = $1 AND uuid = $2::uuid`,
      [res.body.id],
    );
    expect(run!.requested_by).not.toBeNull();
    await sync.execute(t.orgId, Number(run!.id));

    const done = (await api.as(t.admin).get('/v2/lead-inbox/runs')).body.data.find(
      (r: { id: string }) => r.id === res.body.id,
    );
    expect(done).toMatchObject({
      status: 'done',
      fetched: 3,
      accepted: 2,
      duplicates: 1,
      failed: 0,
      error: null,
    });
    expect(done.finishedAt).not.toBeNull();
    expect(pulls).toHaveLength(1);
    expect(pulls[0]).toMatchObject({ mode: 'sync', from: null, to: null });

    const audit = await api.rows(
      t.orgId,
      `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'lead_sync_runs' ORDER BY id`,
    );
    expect(audit.map((a) => a.action)).toEqual(['insert', 'update']);
    const events = await api.rows(
      t.orgId,
      `SELECT event_type FROM event_outbox WHERE org_id = $1 AND event_type LIKE 'lead.sync.%' ORDER BY id`,
    );
    expect(events.map((e) => e.event_type)).toEqual(['lead.sync.requested', 'lead.sync.finished']);
  });

  it("is rate limited: asking again within the source's interval is 429 with the seconds to wait", async () => {
    const res = await post(t.admin, `/v2/lead-inbox/sources/${syncOnly}/sync`);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('LEAD_SYNC_TOO_SOON');
    const wait = res.body.errors.find((e: { path: string }) => e.path === 'retryAfterSeconds');
    expect(Number(wait.message)).toBeGreaterThan(0);
    expect(Number(wait.message)).toBeLessThanOrEqual(60);
    const listed = (await api.as(t.admin).get('/v2/lead-inbox/sources')).body.data.find(
      (r: { sourceId: string }) => r.sourceId === syncOnly,
    );
    expect(listed.nextSyncAt).not.toBeNull();
    expect(listed.lastRun.status).toBe('done');
  });

  it('a source that stops early or is refused is recorded as such, with a stable code and no provider text', async () => {
    await h.owner.query(
      `UPDATE lead_sync_runs SET created_at = now() - interval '2 hours' WHERE org_id = $1`,
      [t.orgId],
    );
    behave = async (req) => {
      const progress = {
        fetched: 1,
        accepted: 1,
        duplicates: 0,
        failed: 0,
        windowsDone: 1,
        windowsTotal: 1,
      };
      await req.progress(progress);
      return { status: 'failed', error: 'credentials_refused', progress };
    };
    const res = await post(t.admin, `/v2/lead-inbox/sources/${syncOnly}/sync`);
    expect(res.status).toBe(202);
    const [run] = await api.rows(
      t.orgId,
      `SELECT id FROM lead_sync_runs WHERE org_id = $1 AND uuid = $2::uuid`,
      [res.body.id],
    );
    await sync.execute(t.orgId, Number(run!.id));
    const failed = (await api.as(t.admin).get('/v2/lead-inbox/runs?limit=1')).body.data[0];
    expect(failed).toMatchObject({ status: 'failed', error: 'credentials_refused', accepted: 1 });

    // a provider that throws does not leave the run running
    await h.owner.query(
      `UPDATE lead_sync_runs SET created_at = now() - interval '2 hours' WHERE org_id = $1`,
      [t.orgId],
    );
    behave = async () => {
      throw new Error('boom +919876543210');
    };
    const crash = await post(t.admin, `/v2/lead-inbox/sources/${syncOnly}/sync`);
    const [run2] = await api.rows(
      t.orgId,
      `SELECT id FROM lead_sync_runs WHERE org_id = $1 AND uuid = $2::uuid`,
      [crash.body.id],
    );
    await sync.execute(t.orgId, Number(run2!.id));
    const after = (await api.as(t.admin).get('/v2/lead-inbox/runs?limit=1')).body.data[0];
    expect(after).toMatchObject({ status: 'failed', error: 'internal_error' });
    expect(JSON.stringify(after)).not.toContain('9876543210');
    behave = async (req) => {
      const progress = {
        fetched: 3,
        accepted: 2,
        duplicates: 1,
        failed: 0,
        windowsDone: 1,
        windowsTotal: 1,
      };
      await req.progress(progress);
      return { status: 'ok', progress };
    };
  });

  it('backfill pulls the range at the sources that can, and says why it skipped the others', async () => {
    pulls.length = 0;
    await h.owner.query(
      `UPDATE lead_sync_runs SET created_at = now() - interval '2 hours' WHERE org_id = $1`,
      [t.orgId],
    );
    const from = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const to = new Date(Date.now() - 86_400_000).toISOString();
    const res = await post(t.admin, '/v2/lead-inbox/backfill', { from, to });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0]).toMatchObject({
      kind: 'backfill',
      sourceName: 'Portal both',
      status: 'queued',
    });
    expect(new Date(res.body.runs[0].rangeFrom).toISOString()).toBe(from);
    expect(res.body.skipped).toEqual(
      expect.arrayContaining([
        { sourceId: syncOnly, reason: 'not_supported' },
        { sourceId: hook.id, reason: 'not_supported' },
      ]),
    );

    const [run] = await api.rows(
      t.orgId,
      `SELECT id FROM lead_sync_runs WHERE org_id = $1 AND uuid = $2::uuid`,
      [res.body.runs[0].id],
    );
    await sync.execute(t.orgId, Number(run!.id));
    expect(pulls).toHaveLength(1);
    expect(pulls[0]).toMatchObject({ mode: 'backfill' });
    expect(pulls[0]!.from!.toISOString()).toBe(from);
    expect(pulls[0]!.to!.toISOString()).toBe(to);

    // a second backfill of the same source waits ten minutes
    const again = await post(t.admin, '/v2/lead-inbox/backfill', { from, to, sourceIds: [both] });
    expect(again.status).toBe(202);
    expect(again.body.runs).toHaveLength(0);
    expect(again.body.skipped).toEqual([{ sourceId: both, reason: 'too_soon' }]);
  });

  it('refuses a range that is backwards, wider than 90 days or in the future, and skips a source that does not reach that far back', async () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(
      (await post(t.admin, '/v2/lead-inbox/backfill', { from: iso(now), to: iso(now - 1000) }))
        .status,
    ).toBe(422);
    expect(
      (
        await post(t.admin, '/v2/lead-inbox/backfill', {
          from: iso(now - 100 * 86_400_000),
          to: iso(now),
        })
      ).status,
    ).toBe(422);
    const future = await post(t.admin, '/v2/lead-inbox/backfill', {
      from: iso(now - 86_400_000),
      to: iso(now + 3_600_000),
    });
    expect(future.status).toBe(422);
    expect(future.body.code).toBe('LEAD_BACKFILL_RANGE_INVALID');

    await h.owner.query(
      `UPDATE lead_sync_runs SET created_at = now() - interval '2 hours' WHERE org_id = $1`,
      [t.orgId],
    );
    const old = await post(t.admin, '/v2/lead-inbox/backfill', {
      from: iso(now - 60 * 86_400_000),
      to: iso(now - 50 * 86_400_000),
      sourceIds: [both],
    });
    expect(old.status).toBe(202);
    expect(old.body.skipped).toEqual([{ sourceId: both, reason: 'range_too_old' }]);
  });

  it("one run at a time per source is the database's rule, not only the code's", async () => {
    const t2 = await api.signup('inboxsync2');
    const s = await connector(t2, 'Portal two', 'fake-sync');
    const [row] = await api.rows(
      t2.orgId,
      `SELECT id FROM lead_sources WHERE org_id = $1 AND uuid = $2::uuid`,
      [s],
    );
    await h.owner.query(
      `INSERT INTO lead_sync_runs (org_id, source_id, kind) VALUES ($1, $2, 'sync')`,
      [t2.orgId, row!.id],
    );
    await expect(
      h.owner.query(
        `INSERT INTO lead_sync_runs (org_id, source_id, kind) VALUES ($1, $2, 'sync')`,
        [t2.orgId, row!.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    // a backfill needs its range, a sync must not have one
    await expect(
      h.owner.query(
        `INSERT INTO lead_sync_runs (org_id, source_id, kind, status) VALUES ($1, $2, 'backfill', 'done')`,
        [t2.orgId, row!.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('a run that stopped reporting is freed, one whose job was lost is found, and history past 90 days goes', async () => {
    const t3 = await api.signup('inboxsync3');
    const s = await connector(t3, 'Portal three', 'fake-sync');
    const [row] = await api.rows(
      t3.orgId,
      `SELECT id FROM lead_sources WHERE org_id = $1 AND uuid = $2::uuid`,
      [s],
    );
    const runs = new LeadSyncRunsRepository();
    const db = h.app.get(DatabaseService, { strict: false });
    await h.owner.query(
      `INSERT INTO lead_sync_runs (org_id, source_id, kind, status, started_at, heartbeat_at) VALUES ($1, $2, 'sync', 'running', now() - interval '3 hours', now() - interval '3 hours')`,
      [t3.orgId, row!.id],
    );
    expect(await db.privileged((tx) => runs.failAbandoned(tx, 20 * 60))).toBeGreaterThanOrEqual(1);
    const [freed] = await api.rows(
      t3.orgId,
      `SELECT status, error FROM lead_sync_runs WHERE org_id = $1`,
    );
    expect(freed).toMatchObject({ status: 'failed', error: 'interrupted' });

    await h.owner.query(
      `INSERT INTO lead_sync_runs (org_id, source_id, kind, status, created_at) VALUES ($1, $2, 'sync', 'queued', now() - interval '5 minutes')`,
      [t3.orgId, row!.id],
    );
    const lost = await db.privileged((tx) => runs.staleQueued(tx, 60, 50));
    expect(lost.some((x) => x.orgId === t3.orgId)).toBe(true);

    await h.owner.query(
      `UPDATE lead_sync_runs SET status = 'done', finished_at = now() - interval '100 days' WHERE org_id = $1 AND status = 'queued'`,
      [t3.orgId],
    );
    await new LeadRetentionSweepService(db, runs).run();
    const left = await api.rows(t3.orgId, `SELECT status FROM lead_sync_runs WHERE org_id = $1`);
    expect(left.map((r) => r.status)).toEqual(['failed']);
  });

  it('row-level security is forced on the runs', async () => {
    const other = await api.signup('inboxsyncrls');
    const app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    try {
      expect((await app.query(`SELECT count(*)::int AS n FROM lead_sync_runs`)).rows[0].n).toBe(0);
      for (const [org, expected] of [
        [other.orgId, 0],
        [t.orgId, 1],
      ] as const) {
        await app.query('BEGIN');
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
        const n = (await app.query(`SELECT count(*)::int AS n FROM lead_sync_runs`)).rows[0].n;
        await app.query('ROLLBACK');
        if (expected === 1) expect(n).toBeGreaterThanOrEqual(1);
        else expect(n).toBe(0);
      }
    } finally {
      await app.end();
    }
  });

  it('read-only members see the pull sources and their runs', async () => {
    const reader = await api.member(t, 'inboxsyncreader', LEAD_READ);
    expect((await api.as(reader.token).get('/v2/lead-inbox/sources')).status).toBe(200);
    expect((await api.as(reader.token).get('/v2/lead-inbox/runs')).status).toBe(200);
    const manager = await api.member(t, 'inboxsyncmanager', LEAD_MANAGE);
    expect((await api.as(manager.token).get('/v2/lead-inbox/sources')).status).toBe(200);
  });
});
