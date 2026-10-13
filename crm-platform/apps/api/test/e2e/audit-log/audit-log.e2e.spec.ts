import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { until, startPipeline, type Pipeline } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';

/**
 * The tenant audit log end to end: the real API, real Postgres (restricted role, forced RLS, partitioned `audit_log`), real Redis, and
 * the export worker loaded into the same process. Rows are arranged with the owner connection; everything asserted goes through HTTP.
 */
let p: Pipeline;
let t: Tenant; // admin = the workspace owner (holds every key, including the Owner-only reveal key)
let other: Tenant;
let reader: { token: string; userId: number }; // audit.log.read only: masked values, no export
let exporter: { token: string; userId: number }; // read + export, still no reveal
let nobody: { token: string; userId: number }; // neither key (what Manager has by default)

let contactId = 0;
let contactUuid = '';
let sessionUuid = '';
const REQ = 'req-abc-123';

const A = (token: string) => p.api.as(token);
const insert = async (
  orgId: number,
  r: {
    actorId?: number | null;
    actorType?: string;
    module: string;
    recordId: number;
    action: string;
    delta?: unknown;
    requestId?: string | null;
    at?: string;
  },
) =>
  Number(
    (
      await p.h.owner.query(
        `INSERT INTO audit_log (id, org_id, actor_id, actor_type, module, record_id, action, delta, request_id, at)
         VALUES (nextval('audit_log_id_seq'), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, COALESCE($9::timestamptz, now()))
         RETURNING id`,
        [
          orgId,
          r.actorId ?? null,
          r.actorType ?? 'user',
          r.module,
          r.recordId,
          r.action,
          r.delta === undefined ? null : JSON.stringify(r.delta),
          r.requestId ?? null,
          r.at ?? null,
        ],
      )
    ).rows[0].id,
  );
const auditCount = async (orgId: number, module: string, action: string) =>
  Number(
    (
      await p.h.owner.query(
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = $2 AND action = $3`,
        [orgId, module, action],
      )
    ).rows[0].n,
  );

beforeAll(async () => {
  p = await startPipeline(async () => [
    (await import('../../../src/modules/audit-log/audit-log-worker.module')).AuditLogWorkerModule,
  ]);
  t = await p.api.signup('auditlog');
  other = await p.api.signup('auditother');
  reader = await p.api.member(t, 'reader', [['audit.log.read']]);
  exporter = await p.api.member(t, 'exporter', [['audit.log.read'], ['audit.log.export']]);
  nobody = await p.api.member(t, 'nobody', [['record.contacts.read']]);

  [contactUuid] = await p.api.seedContacts(t, [{ name: 'Sara Ali', phone: '+919876543210' }]);
  contactId = Number(
    (await p.h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contactUuid])).rows[0].id,
  );

  // A platform operator and the support session that wrote one row on the owner's behalf.
  const op = await p.h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash) VALUES ($1, 'Support Person', 'x') RETURNING id, uuid`,
    [`op${Date.now()}@example.test`],
  );
  const sess = await p.h.owner.query(
    `INSERT INTO impersonation_sessions (target_workspace_id, target_user_id, operator_id, reason, expires_at, handoff_expires_at)
     VALUES ($1, $2, $3, 'Ticket 4411: help with the import', now() + interval '1 hour', now() + interval '1 minute')
     RETURNING uuid`,
    [t.orgId, t.adminUserId, op.rows[0].id],
  );
  sessionUuid = sess.rows[0].uuid as string;

  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  // 1 old row, outside the default 30 days.
  await insert(t.orgId, { actorId: t.adminUserId, module: 'tags', recordId: 1, action: 'insert', at: day(60) });
  // A contact edit with personal data and a secret.
  await insert(t.orgId, {
    actorId: t.adminUserId,
    module: 'contacts',
    recordId: contactId,
    action: 'update',
    requestId: REQ,
    at: day(3),
    delta: {
      phone: { old: '+919876543210', new: '+971501234567' },
      email: { old: null, new: 'sara@example.com' },
      name: { old: 'Sara Ali', new: 'Sara Al-Ali' },
      notes: { old: null, new: 'owes secretword money' },
      smtp_password: { old: 'old-pass', new: 'hunter2' },
      stage: { old: 'new', new: 'won' },
    },
  });
  await insert(t.orgId, { actorId: t.adminUserId, module: 'contacts', recordId: 999999, action: 'delete', at: day(2) });
  await insert(t.orgId, { actorId: null, actorType: 'system', module: 'conversations', recordId: 5, action: 'update', at: day(2) });
  await insert(t.orgId, { actorId: null, actorType: 'api_key', module: 'deals', recordId: 8, action: 'insert', at: day(1) });
  // The row written while support acted as the owner (the stamp the DB trigger adds).
  await insert(t.orgId, {
    actorId: t.adminUserId,
    module: 'tags',
    recordId: 2,
    action: 'update',
    at: day(1),
    delta: {
      name: { old: 'VIP', new: 'Gold' },
      _impersonatedBy: { old: null, new: { operatorId: String(op.rows[0].uuid), sessionId: sessionUuid } },
    },
  });
  // Another workspace's row: nobody here may see it.
  await insert(other.orgId, {
    actorId: other.adminUserId,
    module: 'contacts',
    recordId: 1,
    action: 'update',
    delta: { phone: { old: '1', new: '+10000000000' } },
  });
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

const list = async (token: string, query = '') => {
  const res = await A(token).get(`/v2/audit-log${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as {
    data: Array<{
      id: string;
      at: string;
      module: string;
      action: string;
      recordId: string;
      requestId: string | null;
      changedFields: string[];
      actor: { kind: string; id: string | null; name: string | null };
      record: { href: string | null };
      actAs: { reason: string | null; readOnly: boolean | null } | null;
    }>;
    page: { nextCursor: string | null; hasMore: boolean };
  };
};

describe('who may read', () => {
  it('Owner and a role with audit.log.read can; a role without it cannot', async () => {
    expect((await A(t.admin).get('/v2/audit-log')).status).toBe(200);
    expect((await A(reader.token).get('/v2/audit-log')).status).toBe(200);
    for (const path of ['/v2/audit-log', '/v2/audit-log/settings', '/v2/audit-log/facets', '/v2/audit-log/exports']) {
      expect((await A(nobody.token).get(path)).status, path).toBe(403);
    }
  });
  it('the export keys are separate from the read key', async () => {
    expect((await A(reader.token).get('/v2/audit-log/exports')).status).toBe(403);
    expect((await A(reader.token).post('/v2/audit-log/exports').send({})).status).toBe(403);
    expect((await A(exporter.token).get('/v2/audit-log/exports')).status).toBe(200);
  });
  it('the new keys are held by the Admin presets and not by Manager', async () => {
    const baseline = await p.h.owner.query(
      `SELECT preset_key, permission_key FROM workspace_preset_baseline WHERE permission_key LIKE 'audit.log.%' ORDER BY 1, 2`,
    );
    const presets = new Set(baseline.rows.map((r) => r.preset_key as string));
    expect(presets.has('manager')).toBe(false);
    expect(presets.has('admin')).toBe(true);
  });
});

describe('list, filters and paging', () => {
  it('newest first, last 30 days by default, field names but never values', async () => {
    const r = await list(t.admin);
    expect(r.data.some((e) => e.module === 'tags' && e.action === 'insert' && e.recordId === '1')).toBe(false); // 60 days old
    const times = r.data.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
    const edit = r.data.find((e) => e.module === 'contacts' && e.action === 'update')!;
    expect(edit.changedFields.sort()).toEqual(['email', 'name', 'notes', 'phone', 'smtp_password', 'stage']);
    expect(JSON.stringify(r)).not.toContain('hunter2');
    expect(JSON.stringify(r)).not.toContain('+971501234567');
    expect(JSON.stringify(r)).not.toContain('secretword');
  });

  it('a wider range finds the old row; a range past 400 days is a 422', async () => {
    const from = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const r = await list(t.admin, `?from=${encodeURIComponent(from)}&module=tags&action=insert`);
    expect(r.data).toHaveLength(1);
    const bad = await A(t.admin).get(
      `/v2/audit-log?from=${encodeURIComponent('2020-01-01T00:00:00.000Z')}`,
    );
    expect(bad.status).toBe(422);
    expect(bad.body.code ?? bad.body.error?.code).toBe('AUDIT_RANGE_INVALID');
  });

  it('filters by module, action, record, request id and actor type', async () => {
    expect((await list(t.admin, '?module=deals')).data.map((e) => e.module)).toEqual(['deals']);
    expect((await list(t.admin, '?module=contacts&action=delete')).data).toHaveLength(1);
    expect((await list(t.admin, `?module=contacts&recordId=${contactId}`)).data).toHaveLength(1);
    expect((await list(t.admin, `?requestId=${REQ}`)).data).toHaveLength(1);
    const sys = await list(t.admin, '?actorType=system');
    expect(sys.data).toHaveLength(1);
    expect(sys.data[0]!.actor).toEqual({ kind: 'system', id: null, name: null });
    const key = await list(t.admin, '?actorType=api_key');
    expect(key.data).toHaveLength(1);
  });

  it('filters by actor (a user uuid) and resolves their name', async () => {
    const session = await A(t.admin).get('/v2/auth/session');
    const uuid = (session.body.user?.id ?? session.body.user?.uuid) as string | undefined;
    const all = await list(t.admin);
    const person = all.data.find((e) => e.module === 'contacts' && e.action === 'update')!;
    expect(person.actor.name).toBe('Admin Person');
    const byActor = await list(t.admin, `?actorId=${person.actor.id}`);
    expect(byActor.data.length).toBeGreaterThan(0);
    expect(byActor.data.every((e) => e.actor.id === person.actor.id)).toBe(true);
    // A uuid that is nobody in this workspace gives an empty page, not an error.
    const none = await list(t.admin, '?actorId=3f0b9f0e-6c1c-4a39-9b7e-0d4d2b0c1a11');
    expect(none.data).toEqual([]);
    expect(uuid === undefined || typeof uuid === 'string').toBe(true);
  });

  it('text search matches the module and the action, never the changed values', async () => {
    expect((await list(t.admin, '?q=deal')).data.map((e) => e.module)).toEqual(['deals']);
    expect((await list(t.admin, '?q=delet')).data.map((e) => e.action)).toEqual(['delete']);
    expect((await list(t.admin, '?q=secretword')).data).toEqual([]);
    expect((await list(t.admin, '?q=sara')).data).toEqual([]);
    // `%` is literal, not a wildcard.
    expect((await list(t.admin, '?q=%25')).data).toEqual([]);
  });

  it('links a record to its screen when the type has one and the record exists', async () => {
    const r = await list(t.admin, '?module=contacts');
    const live = r.data.find((e) => e.action === 'update')!;
    const gone = r.data.find((e) => e.action === 'delete')!;
    expect(live.record.href).toBe(`/contacts/${contactUuid}`);
    expect(gone.record.href).toBeNull();
  });

  it('pages with a cursor without gaps or repeats', async () => {
    const full = await list(t.admin, '?limit=100');
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page = await list(t.admin, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.data.map((e) => e.id));
      cursor = page.page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(full.data.map((e) => e.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect((await A(t.admin).get('/v2/audit-log?cursor=not-a-cursor')).status).toBe(404);
  });

  it('facets list the modules and actions present', async () => {
    const res = await A(t.admin).get('/v2/audit-log/facets');
    expect(res.status).toBe(200);
    expect(res.body.modules).toEqual(expect.arrayContaining(['contacts', 'deals', 'tags', 'conversations']));
    expect(res.body.actions).toEqual(expect.arrayContaining(['insert', 'update', 'delete']));
    expect(res.body.actors).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Admin Person' })]));
    // Only people of this workspace.
    expect((await A(other.admin).get('/v2/audit-log/facets')).body.actors).toHaveLength(1);
  });

  it('settings: retention (the platform default is 365 days) and what the viewer may do', async () => {
    const owner = await A(t.admin).get('/v2/audit-log/settings');
    expect(owner.body).toEqual({ retentionDays: 365, canExport: true, canReveal: true });
    const r = await A(reader.token).get('/v2/audit-log/settings');
    expect(r.body).toEqual({ retentionDays: 365, canExport: false, canReveal: false });
  });
});

describe('tenant isolation', () => {
  it("another workspace's rows never appear, in the list, the facets or the detail", async () => {
    const mine = await list(other.admin);
    const ours = new Set((await list(t.admin, '?limit=100')).data.map((e) => e.id));
    expect(mine.data.every((e) => !ours.has(e.id))).toBe(true);
    expect(mine.data.some((e) => e.module === 'deals')).toBe(false);
    const theirs = (await list(t.admin, '?module=deals')).data[0]!;
    expect((await A(other.admin).get(`/v2/audit-log/${theirs.id}`)).status).toBe(404);
    const facets = await A(other.admin).get('/v2/audit-log/facets');
    expect(facets.body.modules).not.toContain('deals');
  });
  it('a support session of another workspace is not described to this one', async () => {
    const row = (await list(other.admin, '?module=contacts')).data[0]!;
    expect(row.actAs).toBeNull();
  });
});

describe('platform support (act-as) visibility', () => {
  it('flags the row and gives the reason', async () => {
    const r = await list(t.admin, '?actAs=true&module=tags');
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.actAs).toMatchObject({ reason: 'Ticket 4411: help with the import', readOnly: false });
    expect(r.data[0]!.actor.name).toBe('Admin Person'); // "acting as <owner>"
    expect(r.data[0]!.changedFields).toEqual(['name']); // the stamp is not a field change
    const plain = await list(t.admin, '?module=deals');
    expect(plain.data[0]!.actAs).toBeNull();
  });
  it('the reader with only audit.log.read sees it too', async () => {
    expect((await list(reader.token, '?actAs=true&module=tags')).data).toHaveLength(1);
  });
  it('reads the stamp the database trigger really writes (not only a hand-made one)', async () => {
    // One simple-protocol batch on the owner connection: the settings are transaction-local, as the API sets them.
    await p.h.owner.query(
      `BEGIN;
       SELECT set_config('app.impersonator_id', '8d1e2f3a-0000-4000-8000-000000000001', true), set_config('app.impersonation_id', '${sessionUuid}', true);
       INSERT INTO audit_log (id, org_id, actor_id, actor_type, module, record_id, action, delta)
       VALUES (nextval('audit_log_id_seq'), ${t.orgId}, ${t.adminUserId}, 'user', 'stamped', 1, 'update', '{"stage":{"old":"a","new":"b"}}'::jsonb);
       COMMIT;`,
    );
    const r = await list(t.admin, '?module=stamped');
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.actAs).toMatchObject({ reason: 'Ticket 4411: help with the import' });
    expect(r.data[0]!.changedFields).toEqual(['stage']);
  });
});

describe('the detail, its masking and the audit of reading it', () => {
  const editId = async () =>
    (await list(t.admin, '?module=contacts&action=update')).data[0]!.id;

  it('masks personal values and redacts secrets for a reader without the Owner key', async () => {
    const res = await A(reader.token).get(`/v2/audit-log/${await editId()}`);
    expect(res.status).toBe(200);
    expect(res.body.canReveal).toBe(false);
    expect(res.body.delta.phone).toEqual({ old: '+91 ******210', new: '+97 ******567', masked: true });
    expect(res.body.delta.email.new).toBe('s***@example.com');
    expect(res.body.delta.name.new).toBe('S*** A***');
    expect(res.body.delta.notes.new).toBe('[hidden text]');
    expect(res.body.delta.smtp_password).toEqual({ old: '[REDACTED]', new: '[REDACTED]', masked: true });
    expect(res.body.delta.stage).toEqual({ old: 'new', new: 'won', masked: false });
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|old-pass|971501234567|secretword|sara@example/);
  });

  it('shows personal values to the Owner but never a secret', async () => {
    const res = await A(t.admin).get(`/v2/audit-log/${await editId()}`);
    expect(res.body.canReveal).toBe(true);
    expect(res.body.delta.phone.new).toBe('+971501234567');
    expect(res.body.delta.notes.new).toBe('owes secretword money');
    expect(res.body.delta.smtp_password.new).toBe('[REDACTED]');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('opening an entry is itself audited: who, which entry, and whether values were revealed', async () => {
    const before = await auditCount(t.orgId, 'audit-log', 'read');
    const id = await editId();
    await A(reader.token).get(`/v2/audit-log/${id}`);
    await A(t.admin).get(`/v2/audit-log/${id}`);
    expect(await auditCount(t.orgId, 'audit-log', 'read')).toBe(before + 2);
    const rows = (
      await p.h.owner.query(
        `SELECT actor_id, delta FROM audit_log WHERE org_id = $1 AND module = 'audit-log' AND action = 'read' ORDER BY id DESC LIMIT 2`,
        [t.orgId],
      )
    ).rows;
    expect(Number(rows[0].actor_id)).toBe(t.adminUserId);
    expect(rows[0].delta.revealed.new).toBe(true);
    expect(Number(rows[1].actor_id)).toBe(reader.userId);
    expect(rows[1].delta.revealed.new).toBe(false);
    // The read rows are visible in the log itself.
    expect((await list(t.admin, '?module=audit-log&action=read')).data.length).toBeGreaterThanOrEqual(2);
  });

  it('listing and filtering are not audited', async () => {
    const before = await auditCount(t.orgId, 'audit-log', 'read');
    await list(t.admin, '?module=contacts');
    await list(t.admin, '?q=contacts');
    expect(await auditCount(t.orgId, 'audit-log', 'read')).toBe(before);
  });

  it('an unknown or foreign entry id is 404', async () => {
    expect((await A(t.admin).get('/v2/audit-log/garbage')).status).toBe(404);
    expect(
      (await A(t.admin).get(`/v2/audit-log/${Buffer.from('2026-01-01T00:00:00.000000Z|99999999').toString('base64url')}`)).status,
    ).toBe(404);
  });

  it('a delta in a shape other than {old,new} does not break the detail', async () => {
    const id = await insert(t.orgId, { actorId: t.adminUserId, module: 'weird', recordId: 1, action: 'update', delta: { count: 3, list: ['a@b.com'] } });
    expect(id).toBeGreaterThan(0);
    const e = (await list(t.admin, '?module=weird')).data[0]!;
    const res = await A(reader.token).get(`/v2/audit-log/${e.id}`);
    expect(res.status).toBe(200);
    expect(res.body.delta.count).toEqual({ new: 3, masked: false });
    expect(res.body.delta.list.new).toEqual(['a***@b.com']);
  });
});

describe('export', () => {
  it('builds a masked CSV in the worker, audited, one at a time', async () => {
    const before = await auditCount(t.orgId, 'audit-log-exports', 'export');
    const req = await A(exporter.token)
      .post('/v2/audit-log/exports')
      .set('idempotency-key', `exp-${Date.now()}`)
      .send({ module: 'contacts' });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    expect(req.body.status).toBe('queued');
    expect(await auditCount(t.orgId, 'audit-log-exports', 'export')).toBe(before + 1);

    const done = await until('export ready', async () => {
      const l = await A(exporter.token).get('/v2/audit-log/exports');
      const e = (l.body.data as Array<{ id: string; status: string }>).find((x) => x.id === req.body.id);
      return e?.status === 'ready' ? e : e?.status === 'failed' ? Promise.reject(new Error('export failed')) : undefined;
    }, 60_000);
    expect(done.status).toBe('ready');

    const file = await A(exporter.token).get(`/v2/audit-log/exports/${req.body.id}/download`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('text/csv');
    const csv = file.text;
    expect(csv).toContain('time_utc,actor_type,actor,acting_as_support');
    expect(csv).toContain('contacts');
    expect(csv).not.toContain('deals'); // the filter was applied
    // Masked whoever asked, secrets redacted.
    expect(csv).not.toMatch(/hunter2|old-pass|971501234567|secretword|sara@example\.com/);
    expect(csv).toContain('+97 ******567');
    expect(csv).toContain('[REDACTED]');
  });

  it('a second request while one is queued or running is 409', async () => {
    await p.h.owner.query(
      `INSERT INTO audit_log_exports (org_id, requested_by, status) VALUES ($1, $2, 'running')`,
      [t.orgId, t.adminUserId],
    );
    const res = await A(t.admin).post('/v2/audit-log/exports').set('idempotency-key', `exp2-${Date.now()}`).send({});
    expect(res.status).toBe(409);
    await p.h.owner.query(`UPDATE audit_log_exports SET status = 'failed' WHERE org_id = $1 AND status = 'running'`, [t.orgId]);
  });

  it('a support-session row appears in the file with the reason; formulas are defused', async () => {
    await insert(t.orgId, {
      actorId: t.adminUserId,
      module: '=cmd|calc',
      recordId: 1,
      action: 'update',
    });
    const req = await A(t.admin)
      .post('/v2/audit-log/exports')
      .set('idempotency-key', `exp3-${Date.now()}`)
      .send({});
    expect(req.status).toBe(202);
    await until('export ready', async () => {
      const l = await A(t.admin).get('/v2/audit-log/exports');
      return (l.body.data as Array<{ id: string; status: string }>).find((x) => x.id === req.body.id && x.status === 'ready');
    }, 60_000);
    const csv = (await A(t.admin).get(`/v2/audit-log/exports/${req.body.id}/download`)).text;
    expect(csv).toContain('yes,Ticket 4411: help with the import');
    expect(csv).toContain(`"'=cmd|calc"`);
  });

  it("another workspace cannot list or download this workspace's export", async () => {
    const mine = (await A(t.admin).get('/v2/audit-log/exports')).body.data as Array<{ id: string }>;
    expect(mine.length).toBeGreaterThan(0);
    expect((await A(other.admin).get('/v2/audit-log/exports')).body.data).toEqual([]);
    expect((await A(other.admin).get(`/v2/audit-log/exports/${mine[0]!.id}/download`)).status).toBe(404);
  });

  it('the sweep expires an old file and fails a stuck export', async () => {
    const { AuditLogExportSweepService } = await import(
      '../../../src/modules/audit-log/audit-log-export-sweep.service'
    );
    const sweep = p.h.app.get(AuditLogExportSweepService);
    await p.h.owner.query(
      `UPDATE audit_log_exports SET expires_at = now() - interval '1 day' WHERE org_id = $1 AND status = 'ready'`,
      [t.orgId],
    );
    await p.h.owner.query(
      `INSERT INTO audit_log_exports (org_id, requested_by, status, started_at) VALUES ($1, $2, 'running', now() - interval '3 hours')`,
      [t.orgId, t.adminUserId],
    );
    const out = await sweep.sweep();
    expect(out.expired).toBeGreaterThanOrEqual(1);
    expect(out.failed).toBeGreaterThanOrEqual(1);
    const list2 = (await A(t.admin).get('/v2/audit-log/exports')).body.data as Array<{ id: string; status: string }>;
    const expired = list2.find((e) => e.status === 'expired')!;
    expect((await A(t.admin).get(`/v2/audit-log/exports/${expired.id}/download`)).status).toBe(409);
  });
});
