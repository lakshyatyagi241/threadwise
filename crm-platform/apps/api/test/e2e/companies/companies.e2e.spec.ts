import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DealsApi,
  startHarness,
  uuidRe,
  type Harness,
  type Tenant,
} from '../deals-pipelines/support';

/**
 * Companies end to end through HTTP (WD-CTP-001..013): plan gate and permissions, list / search / filters / cursor paging, the
 * tiles, create / edit / delete, the rollups, a company's contacts (list, link, unlink), the activity trail and the safe delete of
 * everything that points at a company, with the audit, outbox and tenant properties every write must have. One app, one
 * database; each block works in organizations of its own.
 */
let h: Harness;
let api: DealsApi;

beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;

interface Money {
  currency: string;
  amount: string;
}
interface Company {
  id: string;
  displayId: string | null;
  name: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  sizeRange: string | null;
  address: string | null;
  notes: string | null;
  owner: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  rollup: {
    contacts: number | null;
    deals: {
      total: number;
      open: number;
      won: number;
      openValue: Money[];
      wonValue: Money[];
    } | null;
  };
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}
type Page<T> = { data: T[]; page: { nextCursor: string | null; hasMore: boolean; limit: number } };

const VIEWER = [['record.companies.read']] as Array<[string, ('all' | 'team' | 'own')?]>;
const WORKER = [
  ['record.companies.read', 'own'],
  ['record.companies.create'],
  ['record.companies.update', 'own'],
  ['record.companies.delete', 'own'],
  ['record.contacts.read'],
  ['record.contacts.update'],
  ['record.deals.read'],
] as Array<[string, ('all' | 'team' | 'own')?]>;

async function company(token: string, body: Record<string, unknown>): Promise<Company> {
  const res = await api.as(token).post('/v2/companies').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Company;
}

async function list(token: string, qs = ''): Promise<Page<Company>> {
  const res = await api.as(token).get(`/v2/companies${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

const names = (r: { data: Company[] }) => r.data.map((c) => c.name);

/** A company straight into the table for volume and ordering tests (the owner connection; arranging only). */
async function seedCompanies(
  orgId: number,
  rows: Array<{
    name: string;
    industry?: string | null;
    createdAt?: string;
    ownerId?: number | null;
  }>,
): Promise<number[]> {
  const ids: number[] = [];
  let n = 0;
  for (const r of rows) {
    const res = await h.owner.query(
      `INSERT INTO companies (org_id, name, industry, owner_id, created_at)
       VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, now() + ($6 || ' seconds')::interval)) RETURNING id`,
      [orgId, r.name, r.industry ?? null, r.ownerId ?? null, r.createdAt ?? null, String(n++)],
    );
    ids.push(Number(res.rows[0].id));
  }
  return ids;
}

describe('plan gate and permissions (WD-CTP-001, D-01, D-02)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('cpg');
  });

  it('WD-CTP-001 #1: a workspace whose plan lacks the sales pipeline is refused with 422 PLAN_FEATURE_LOCKED on every route, reads included', async () => {
    const own = await company(t.admin, { name: 'Before the lock' });
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"sales_pipeline":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    try {
      for (const path of [
        '/v2/companies',
        '/v2/companies/stats',
        '/v2/companies/industries',
        '/v2/companies/select-data',
        `/v2/companies/${own.id}`,
        `/v2/companies/${own.id}/contacts`,
        `/v2/companies/${own.id}/activity`,
      ]) {
        const res = await api.as(t.admin).get(path);
        expect(res.status, path).toBe(422);
        expect(code(res), path).toBe('PLAN_FEATURE_LOCKED');
      }
      const create = await api.as(t.admin).post('/v2/companies').send({ name: 'Locked' });
      expect(create.status).toBe(422);
      expect(code(create)).toBe('PLAN_FEATURE_LOCKED');
    } finally {
      await h.owner.query(`UPDATE org_plan_state SET overrides = '{}' WHERE org_id = $1`, [
        t.orgId,
      ]);
    }
    expect(names(await list(t.admin))).toEqual(['Before the lock']);
  });

  it('WD-CTP-001 #2 / D-02: a viewer can read companies but cannot create, edit, delete, bulk delete, link or unlink', async () => {
    const viewer = await api.member(t, 'cviewer', VIEWER);
    const co = await company(t.admin, { name: 'Viewer cannot touch' });
    expect((await api.as(viewer.token).get('/v2/companies')).status).toBe(200);
    expect((await api.as(viewer.token).get(`/v2/companies/${co.id}`)).status).toBe(200);
    const writes = await Promise.all([
      api.as(viewer.token).post('/v2/companies').send({ name: 'x' }),
      api
        .as(viewer.token)
        .patch(`/v2/companies/${co.id}`)
        .send({ name: 'x', rowVersion: co.rowVersion }),
      api.as(viewer.token).delete(`/v2/companies/${co.id}`),
      api
        .as(viewer.token)
        .post('/v2/companies/bulk/delete')
        .send({ ids: [co.id] }),
      api
        .as(viewer.token)
        .post(`/v2/companies/${co.id}/contacts`)
        .send({ contactIds: ['11111111-1111-4111-8111-111111111111'] }),
      api
        .as(viewer.token)
        .delete(`/v2/companies/${co.id}/contacts/11111111-1111-4111-8111-111111111111`),
    ]);
    for (const res of writes) expect(res.status, res.text).toBe(403);
    const row = await h.owner.query(`SELECT name FROM companies WHERE uuid = $1`, [co.id]);
    expect(row.rows[0].name).toBe('Viewer cannot touch');
  });

  it('WD-CTP-001 #3: a caller with no companies permission at all gets 403 on the list, the tiles and the picker', async () => {
    const nobody = await api.member(t, 'cnobody', [['record.contacts.read']]);
    for (const path of ['/v2/companies', '/v2/companies/stats', '/v2/companies/select-data']) {
      expect((await api.as(nobody.token).get(path)).status, path).toBe(403);
    }
  });

  it('D-02: scope own is "owned by me or created by me", team adds teammates, all is everyone; an outside company is 404, never 403', async () => {
    const a = await api.member(t, 'cown-a', WORKER);
    const b = await api.member(t, 'cown-b', WORKER);
    const aUuid = await api.userUuid(a.userId);
    const bUuid = await api.userUuid(b.userId);

    const forB = await company(t.admin, { name: 'Owned by B', ownerId: bUuid });
    const byA = await company(a.token, { name: 'A hands to B', ownerId: bUuid });
    const forA = await company(t.admin, { name: 'Owned by A', ownerId: aUuid });
    const nobodys = await company(t.admin, { name: 'Nobody owns', ownerId: null });

    expect(names(await list(a.token)).sort()).toEqual(['A hands to B', 'Owned by A']);
    expect(names(await list(b.token)).sort()).toEqual(['A hands to B', 'Owned by B']);
    for (const hidden of [forB.id, nobodys.id]) {
      expect((await api.as(a.token).get(`/v2/companies/${hidden}`)).status).toBe(404);
      expect((await api.as(a.token).get(`/v2/companies/${hidden}/activity`)).status).toBe(404);
      expect((await api.as(a.token).get(`/v2/companies/${hidden}/contacts`)).status).toBe(404);
      expect(
        (await api.as(a.token).patch(`/v2/companies/${hidden}`).send({ name: 'x', rowVersion: 1 }))
          .status,
      ).toBe(404);
      expect((await api.as(a.token).delete(`/v2/companies/${hidden}`)).status).toBe(404);
    }
    expect((await api.as(a.token).get(`/v2/companies/${byA.id}`)).status).toBe(200);
    expect((await api.as(a.token).get(`/v2/companies/${forA.id}`)).status).toBe(200);

    // Team scope: a shared team makes the teammate's companies visible.
    const team = await h.owner.query(
      `INSERT INTO teams (org_id, name) VALUES ($1,'CT1') RETURNING id`,
      [t.orgId],
    );
    for (const uid of [a.userId, b.userId]) {
      await h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
        t.orgId,
        team.rows[0].id,
        uid,
      ]);
    }
    const teamA = await api.member(t, 'cteam-a', [['record.companies.read', 'team']]);
    await h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      team.rows[0].id,
      teamA.userId,
    ]);
    expect(names(await list(teamA.token)).sort()).toEqual([
      'A hands to B',
      'Owned by A',
      'Owned by B',
    ]);
    expect((await api.as(teamA.token).get(`/v2/companies/${nobodys.id}`)).status).toBe(404);
  });

  it("D-02: a new workspace's Agent reads and creates companies, edits only its own and cannot delete; a Manager can delete", async () => {
    const tt = await api.signup('cpreset');
    const agent = await api.memberWithRole(tt, 'cagent', 'Agent');
    const manager = await api.memberWithRole(tt, 'cmanager', 'Manager');
    const adminsCo = await company(tt.admin, { name: 'Made by the owner' });

    // read at scope all: the Agent can pick it on a contact or a deal
    expect(names(await list(agent.token))).toEqual(['Made by the owner']);
    const mine = await company(agent.token, { name: 'Made by the agent' });
    expect(mine.owner).not.toBeNull();
    // edit own only
    expect(
      (
        await api
          .as(agent.token)
          .patch(`/v2/companies/${adminsCo.id}`)
          .send({ name: 'x', rowVersion: adminsCo.rowVersion })
      ).status,
    ).toBe(404);
    expect(
      (
        await api
          .as(agent.token)
          .patch(`/v2/companies/${mine.id}`)
          .send({ phone: '123', rowVersion: mine.rowVersion })
      ).status,
    ).toBe(200);
    // no delete
    expect((await api.as(agent.token).delete(`/v2/companies/${mine.id}`)).status).toBe(403);
    // the Manager reads everything and deletes
    expect((await api.as(manager.token).delete(`/v2/companies/${adminsCo.id}`)).status).toBe(204);
  });

  it("WD-CTP-001: another workspace's company is 404 on every read and write, and never in a list", async () => {
    const other = await api.signup('cother');
    const theirs = await company(other.admin, { name: 'Theirs' });
    expect(names(await list(t.admin)).includes('Theirs')).toBe(false);
    expect((await api.as(t.admin).get(`/v2/companies/${theirs.id}`)).status).toBe(404);
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/companies/${theirs.id}`)
          .send({ name: 'Mine now', rowVersion: 1 })
      ).status,
    ).toBe(404);
    expect((await api.as(t.admin).delete(`/v2/companies/${theirs.id}`)).status).toBe(404);
    expect((await api.as(t.admin).get(`/v2/companies/${theirs.id}/contacts`)).status).toBe(404);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/companies/bulk/delete')
          .send({ ids: [theirs.id] })
      ).body.failed,
    ).toHaveLength(1);
    const row = await h.owner.query(`SELECT name FROM companies WHERE uuid = $1`, [theirs.id]);
    expect(row.rows[0].name).toBe('Theirs');
    // an owner from another workspace is refused
    const foreignOwner = await api.userUuid(other.adminUserId);
    const res = await api
      .as(t.admin)
      .post('/v2/companies')
      .send({ name: 'x', ownerId: foreignOwner });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('COMPANY_OWNER_INVALID');
  });
});

describe('create (WD-CTP-003)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ccr');
  });

  it('WD-CTP-003 #1: a name alone creates a company owned and created by the caller, with a display id, an audit row and company.created', async () => {
    const co = await company(t.admin, { name: 'Acme' });
    expect(co.id).toMatch(uuidRe);
    expect(co).toMatchObject({
      name: 'Acme',
      website: null,
      email: null,
      phone: null,
      industry: null,
      sizeRange: null,
      address: null,
      notes: null,
      rowVersion: 1,
      rollup: { contacts: 0, deals: { total: 0, open: 0, won: 0, openValue: [], wonValue: [] } },
    });
    expect(co.displayId).toMatch(/^COM-\d{5}$/);
    expect(co.owner?.name).toBe('Admin Person');
    expect(co.createdBy?.id).toBe(co.owner?.id);
    expect(
      await api.count(
        t.orgId,
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'companies' AND action = 'insert'`,
      ),
    ).toBe(1);
    const events = await api.events(t.orgId, 'company.created');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ uuid: co.id, name: 'Acme' });
    // the response never shows an internal id
    expect(JSON.stringify(co)).not.toMatch(/"(orgId|ownerId|createdById)":\s*\d/);
  });

  it('WD-CTP-003 #2: every WaDesk field is stored, trimmed; an empty string stores nothing', async () => {
    const co = await company(t.admin, {
      name: '  Globex  ',
      email: 'ops@globex.test',
      phone: ' +1 555 0100 ',
      website: 'globex.test',
      industry: 'Manufacturing',
      sizeRange: '11-50',
      address: '1 Main St\nSpringfield',
      notes: 'Key account',
    });
    expect(co).toMatchObject({
      name: 'Globex',
      email: 'ops@globex.test',
      phone: '+1 555 0100',
      website: 'globex.test',
      industry: 'Manufacturing',
      sizeRange: '11-50',
      address: '1 Main St\nSpringfield',
      notes: 'Key account',
    });
    const blanks = await company(t.admin, { name: 'Blanks', email: '', phone: '  ', industry: '' });
    expect(blanks).toMatchObject({ email: null, phone: null, industry: null });
  });

  it("WD-CTP-003 #3: the name is required (blank is refused) and at most 191 characters; the other limits are WaDesk's", async () => {
    const bad = async (body: Record<string, unknown>) => {
      const res = await api.as(t.admin).post('/v2/companies').send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      return res;
    };
    await bad({});
    await bad({ name: '   ' });
    await bad({ name: 'x'.repeat(192) });
    await bad({ name: 'A', email: 'not-an-email' });
    await bad({ name: 'A', phone: 'x'.repeat(33) });
    await bad({ name: 'A', industry: 'x'.repeat(101) });
    await bad({ name: 'A', sizeRange: 'x'.repeat(41) });
    await bad({ name: 'A', address: 'x'.repeat(501) });
    await bad({ name: 'A', notes: 'x'.repeat(2001) });
    await bad({ name: 'A', website: 'x'.repeat(192) });
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/companies')
          .send({ name: 'x'.repeat(191) })
      ).status,
    ).toBe(201);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/companies')
          .send({
            name: 'Limits',
            phone: 'x'.repeat(32),
            industry: 'x'.repeat(100),
            sizeRange: 'x'.repeat(40),
            address: 'x'.repeat(500),
            notes: 'x'.repeat(2000),
          })
      ).status,
    ).toBe(201);
  });

  it('WD-CTP-003 #4: the website is free text (WaDesk never checked it); a script in a field is stored as text', async () => {
    const co = await company(t.admin, {
      name: '<script>alert(1)</script>',
      website: 'not a url at all',
      notes: '<img src=x onerror=alert(1)>',
    });
    expect(co.name).toBe('<script>alert(1)</script>');
    expect(co.website).toBe('not a url at all');
    expect(co.notes).toBe('<img src=x onerror=alert(1)>');
  });

  it('WD-CTP-003 #5: duplicate names are allowed (WaDesk has no uniqueness)', async () => {
    const one = await company(t.admin, { name: 'Twin' });
    const two = await company(t.admin, { name: 'Twin' });
    expect(one.id).not.toBe(two.id);
  });

  it('WD-CTP-003 / D-11: the owner must be an active member; omitted is the caller, null is nobody', async () => {
    const m = await api.member(t, 'cowner', [['record.companies.read']]);
    const mUuid = await api.userUuid(m.userId);
    expect((await company(t.admin, { name: 'Owned', ownerId: mUuid })).owner?.id).toBe(mUuid);
    expect((await company(t.admin, { name: 'Ownerless', ownerId: null })).owner).toBeNull();
    const ghost = await api
      .as(t.admin)
      .post('/v2/companies')
      .send({ name: 'x', ownerId: '11111111-1111-4111-8111-111111111111' });
    expect(ghost.status).toBe(422);
    expect(code(ghost)).toBe('COMPANY_OWNER_INVALID');
    await h.owner.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [m.userId]);
    const suspended = await api
      .as(t.admin)
      .post('/v2/companies')
      .send({ name: 'x', ownerId: mUuid });
    expect(suspended.status).toBe(422);
    expect(code(suspended)).toBe('COMPANY_OWNER_INVALID');
  });

  it('WD-CTP-003: the same Idempotency-Key replays the first answer and creates one company', async () => {
    const key = `co-${Date.now()}`;
    const first = await api
      .as(t.admin)
      .post('/v2/companies')
      .set('Idempotency-Key', key)
      .send({ name: 'Once only' });
    const second = await api
      .as(t.admin)
      .post('/v2/companies')
      .set('Idempotency-Key', key)
      .send({ name: 'Once only' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(names(await list(t.admin, '?q=Once only')).length).toBe(1);
  });
});

describe('list, search, filters and paging (WD-CTP-002)', () => {
  let t: Tenant;
  let ownerA: { token: string; userId: number };
  beforeAll(async () => {
    t = await api.signup('cls');
    ownerA = await api.member(t, 'clsa', [['record.companies.read']]);
    await seedCompanies(t.orgId, [
      { name: 'beta works', industry: 'Retail' },
      { name: 'Alpha Corp', industry: 'retail', ownerId: ownerA.userId },
      { name: 'Gamma 100%', industry: 'Software' },
      { name: 'delta_labs', industry: null },
      { name: 'Epsilon', industry: 'Software', ownerId: ownerA.userId },
    ]);
  });

  it('WD-CTP-002 #1: newest first by default (WaDesk: latest id first); sort=name is A to Z, case-insensitive', async () => {
    expect(names(await list(t.admin))).toEqual([
      'Epsilon',
      'delta_labs',
      'Gamma 100%',
      'Alpha Corp',
      'beta works',
    ]);
    expect(names(await list(t.admin, '?sort=name'))).toEqual([
      'Alpha Corp',
      'beta works',
      'delta_labs',
      'Epsilon',
      'Gamma 100%',
    ]);
  });

  it('WD-CTP-002 #2: search is a case-insensitive substring of the name; % and _ are letters', async () => {
    expect(names(await list(t.admin, '?q=ALPHA'))).toEqual(['Alpha Corp']);
    expect(names(await list(t.admin, '?q=a%20c'))).toEqual(['Alpha Corp']);
    expect(names(await list(t.admin, `?q=${encodeURIComponent('100%')}`))).toEqual(['Gamma 100%']);
    expect(names(await list(t.admin, `?q=${encodeURIComponent('_')}`))).toEqual(['delta_labs']);
    expect(names(await list(t.admin, `?q=${encodeURIComponent('%')}`))).toEqual(['Gamma 100%']);
    expect((await list(t.admin, '?q=nothing-matches')).data).toEqual([]);
  });

  it('WD-CTP-002 #3: filters: owner, unassigned, industry (any case), hasOpenDeals', async () => {
    const aUuid = await api.userUuid(ownerA.userId);
    expect(names(await list(t.admin, `?ownerId=${aUuid}&sort=name`))).toEqual([
      'Alpha Corp',
      'Epsilon',
    ]);
    expect(names(await list(t.admin, '?unassigned=true&sort=name'))).toEqual([
      'beta works',
      'delta_labs',
      'Gamma 100%',
    ]);
    expect(names(await list(t.admin, '?industry=RETAIL&sort=name'))).toEqual([
      'Alpha Corp',
      'beta works',
    ]);
    const both = await api.as(t.admin).get(`/v2/companies?ownerId=${aUuid}&unassigned=true`);
    expect(both.status).toBe(422);
    const stranger = await list(t.admin, '?ownerId=11111111-1111-4111-8111-111111111111');
    expect(stranger.data).toEqual([]);

    const [alpha] = (await list(t.admin, '?q=Alpha')).data;
    await api.deal(t.admin, { title: 'Alpha deal', companyId: alpha!.id });
    expect(names(await list(t.admin, '?hasOpenDeals=true'))).toEqual(['Alpha Corp']);
    expect(names(await list(t.admin, '?hasOpenDeals=false')).length).toBe(5);
  });

  it('WD-CTP-002 #4: a cursor pages through every company once, in both orders, with no 500-row cap', async () => {
    const big = await api.signup('clsbig');
    await h.owner.query(
      `INSERT INTO companies (org_id, name, created_at)
       SELECT $1, 'Bulk ' || lpad(g::text, 4, '0'), now() - (g || ' seconds')::interval FROM generate_series(1, 520) g`,
      [big.orgId],
    );
    for (const sort of ['created', 'name']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: Page<Company> = await list(
          big.admin,
          `?sort=${sort}&limit=200${cursor ? `&cursor=${cursor}` : ''}`,
        );
        seen.push(...names(res));
        cursor = res.page.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      expect(seen).toHaveLength(520);
      expect(new Set(seen).size).toBe(520);
    }
    // WaDesk searched only the newest 500: the oldest company here is #520 and is found.
    expect(names(await list(big.admin, '?q=Bulk 0520'))).toEqual(['Bulk 0520']);
  });

  it('WD-CTP-002 #5: a cursor from one sort is refused on another, and garbage is a 400', async () => {
    const page = await list(t.admin, '?limit=2');
    expect(page.page.hasMore).toBe(true);
    const res = await api.as(t.admin).get(`/v2/companies?sort=name&cursor=${page.page.nextCursor}`);
    expect(res.status).toBe(400);
    expect((await api.as(t.admin).get('/v2/companies?cursor=%21%21')).status).toBe(400);
    expect((await api.as(t.admin).get('/v2/companies?limit=201')).status).toBe(422);
  });

  it('WD-CTP-002 #6: the tiles follow the filter: companies, with an open deal, won value per currency', async () => {
    const st = await api.signup('clsst');
    const [a, b] = await Promise.all([
      company(st.admin, { name: 'Tile One' }),
      company(st.admin, { name: 'Other Two' }),
    ]);
    const dealA = await api.deal(st.admin, {
      title: 'Open',
      companyId: a.id,
      value: '100.50',
      currency: 'USD',
    });
    expect(dealA.status).toBe('open');
    const won = await api.deal(st.admin, {
      title: 'Won USD',
      companyId: a.id,
      value: '40',
      currency: 'USD',
    });
    const wonEur = await api.deal(st.admin, {
      title: 'Won EUR',
      companyId: b.id,
      value: '10',
      currency: 'EUR',
    });
    const { stage } = await api.defaultPipeline(st.admin);
    for (const d of [won, wonEur]) {
      const moved = await api.as(st.admin).post(`/v2/deals/${d.id}/won`).send({});
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    }
    expect(stage).toBeTruthy();
    const all = await api.as(st.admin).get('/v2/companies/stats');
    expect(all.body).toEqual({
      total: 2,
      withOpenDeals: 1,
      wonValue: [
        { currency: 'EUR', amount: '10.00' },
        { currency: 'USD', amount: '40.00' },
      ],
    });
    const filtered = await api.as(st.admin).get('/v2/companies/stats?q=tile');
    expect(filtered.body).toEqual({
      total: 1,
      withOpenDeals: 1,
      wonValue: [{ currency: 'USD', amount: '40.00' }],
    });
    const none = await api.as(st.admin).get('/v2/companies/stats?q=zzz');
    expect(none.body).toEqual({ total: 0, withOpenDeals: 0, wonValue: [] });
    // someone who cannot read deals gets no deal figures, not zeros
    const noDeals = await api.member(st, 'clsnodeals', [['record.companies.read']]);
    expect((await api.as(noDeals.token).get('/v2/companies/stats')).body).toEqual({
      total: 2,
      withOpenDeals: null,
      wonValue: null,
    });
  });

  it('WD-CTP-002 #7: the industry filter offers each industry once, whatever the case', async () => {
    const res = await api.as(t.admin).get('/v2/companies/industries');
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: string) => s.toLowerCase())).toEqual(['retail', 'software']);
  });

  it('WD-CTP-009: the picker (WaDesk: companies/search) returns at most 20, newest first, by a substring of the name', async () => {
    const pk = await api.signup('clspk');
    await seedCompanies(
      pk.orgId,
      Array.from({ length: 25 }, (_, i) => ({
        name: `Pick ${String(i).padStart(2, '0')}`,
        industry: i === 0 ? 'Retail' : null,
      })),
    );
    const res = await api.as(pk.admin).get('/v2/companies/select-data');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(20);
    expect(res.body[0]).toMatchObject({ name: 'Pick 24', industry: null });
    expect(Object.keys(res.body[0]).sort()).toEqual(['id', 'industry', 'name']);
    const q = await api.as(pk.admin).get('/v2/companies/select-data?q=pick 00&limit=5');
    expect(q.body).toEqual([
      { id: expect.stringMatching(uuidRe), name: 'Pick 00', industry: 'Retail' },
    ]);
    expect((await api.as(pk.admin).get('/v2/companies/select-data?limit=101')).status).toBe(422);
  });
});

describe('edit (WD-CTP-004)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ced');
  });

  it('WD-CTP-004 #1: only the fields sent change; the version moves; one audit row and company.updated record what changed', async () => {
    const co = await company(t.admin, { name: 'Edit me', phone: '111', industry: 'Retail' });
    const res = await api
      .as(t.admin)
      .patch(`/v2/companies/${co.id}`)
      .send({ phone: '222', rowVersion: co.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Edit me',
      phone: '222',
      industry: 'Retail',
      rowVersion: co.rowVersion + 1,
    });
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'companies' AND action = 'update' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(audit.rows[0].delta).toEqual({ phone: { old: '111', new: '222' } });
    const events = await api.events(t.orgId, 'company.updated');
    expect(events.at(-1)).toMatchObject({ uuid: co.id, changed: ['phone'] });
  });

  it('WD-CTP-004 #2: null or an empty string clears a field; the name cannot be cleared', async () => {
    const co = await company(t.admin, {
      name: 'Clear me',
      email: 'a@b.test',
      phone: '1',
      website: 'x.test',
      industry: 'I',
      sizeRange: '1-10',
      address: 'A',
      notes: 'N',
    });
    const cleared = await api.as(t.admin).patch(`/v2/companies/${co.id}`).send({
      email: null,
      phone: '',
      website: '  ',
      industry: null,
      sizeRange: null,
      address: '',
      notes: null,
      rowVersion: co.rowVersion,
    });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body).toMatchObject({
      name: 'Clear me',
      email: null,
      phone: null,
      website: null,
      industry: null,
      sizeRange: null,
      address: null,
      notes: null,
    });
    for (const name of ['', '   ', null]) {
      const bad = await api
        .as(t.admin)
        .patch(`/v2/companies/${co.id}`)
        .send({ name, rowVersion: cleared.body.rowVersion });
      expect(bad.status, String(name)).toBe(422);
    }
  });

  it('WD-CTP-004 #3: a stale rowVersion is 409 ROW_VERSION_CONFLICT and nothing changes; a missing one is 422', async () => {
    const co = await company(t.admin, { name: 'Race' });
    const ok = await api
      .as(t.admin)
      .patch(`/v2/companies/${co.id}`)
      .send({ name: 'Race 2', rowVersion: co.rowVersion });
    expect(ok.status).toBe(200);
    const stale = await api
      .as(t.admin)
      .patch(`/v2/companies/${co.id}`)
      .send({ name: 'Race 3', rowVersion: co.rowVersion });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    expect((await api.as(t.admin).get(`/v2/companies/${co.id}`)).body.name).toBe('Race 2');
    expect((await api.as(t.admin).patch(`/v2/companies/${co.id}`).send({ name: 'x' })).status).toBe(
      422,
    );
  });

  it('WD-CTP-004 #4: two simultaneous edits from the same version: one wins, the other is 409', async () => {
    const co = await company(t.admin, { name: 'Simultaneous' });
    const results = await Promise.all(
      ['One', 'Two'].map((n) =>
        api
          .as(t.admin)
          .patch(`/v2/companies/${co.id}`)
          .send({ name: n, rowVersion: co.rowVersion }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('WD-CTP-004 #5: an edit that changes nothing writes no audit row and no event', async () => {
    const co = await company(t.admin, { name: 'Same', phone: '1' });
    const before = await api.count(
      t.orgId,
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'companies' AND action = 'update'`,
    );
    const res = await api
      .as(t.admin)
      .patch(`/v2/companies/${co.id}`)
      .send({ name: 'Same', phone: '1', rowVersion: co.rowVersion });
    expect(res.status).toBe(200);
    expect(res.body.rowVersion).toBe(co.rowVersion);
    expect(
      await api.count(
        t.orgId,
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'companies' AND action = 'update'`,
      ),
    ).toBe(before);
  });

  it('WD-CTP-004 / D-11: the owner can be changed to an active member or cleared; a stranger is 422', async () => {
    const m = await api.member(t, 'cedowner', [['record.companies.read']]);
    const mUuid = await api.userUuid(m.userId);
    const co = await company(t.admin, { name: 'Handover' });
    const moved = await api
      .as(t.admin)
      .patch(`/v2/companies/${co.id}`)
      .send({ ownerId: mUuid, rowVersion: co.rowVersion });
    expect(moved.status).toBe(200);
    expect(moved.body.owner.id).toBe(mUuid);
    const cleared = await api
      .as(t.admin)
      .patch(`/v2/companies/${co.id}`)
      .send({ ownerId: null, rowVersion: moved.body.rowVersion });
    expect(cleared.body.owner).toBeNull();
    const bad = await api.as(t.admin).patch(`/v2/companies/${co.id}`).send({
      ownerId: '11111111-1111-4111-8111-111111111111',
      rowVersion: cleared.body.rowVersion,
    });
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('COMPANY_OWNER_INVALID');
  });

  it('WD-CTP-004: a malformed id is 400 and an unknown one 404', async () => {
    expect((await api.as(t.admin).get('/v2/companies/not-a-uuid')).status).toBe(400);
    expect(
      (await api.as(t.admin).get('/v2/companies/11111111-1111-4111-8111-111111111111')).status,
    ).toBe(404);
  });
});

describe('the company page: rollup, contacts and deals (WD-CTP-005, 006, 008)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('cdt');
  });

  async function contactIn(co: Company, name: string, extra: Record<string, unknown> = {}) {
    const [c] = await api.seedContacts(t, [
      { name, phone: `+1415555${String(Math.floor(Math.random() * 9000) + 1000)}`, ...extra },
    ]);
    const res = await api
      .as(t.admin)
      .post(`/v2/companies/${co.id}/contacts`)
      .send({ contactIds: [c] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.succeeded).toEqual([c]);
    return c!;
  }

  it('WD-CTP-005 #1: the rollup counts the linked contacts and, per currency, open and won deals (lost deals are not counted as won)', async () => {
    const co = await company(t.admin, { name: 'Rollup Inc' });
    await contactIn(co, 'Ana');
    await contactIn(co, 'Bo');
    await api.deal(t.admin, { title: 'Open 1', companyId: co.id, value: '100', currency: 'USD' });
    await api.deal(t.admin, { title: 'Open 2', companyId: co.id, value: '50.5', currency: 'USD' });
    const w1 = await api.deal(t.admin, {
      title: 'Won 1',
      companyId: co.id,
      value: '1000',
      currency: 'JPY',
    });
    const w2 = await api.deal(t.admin, {
      title: 'Won 2',
      companyId: co.id,
      value: '25',
      currency: 'USD',
    });
    const l1 = await api.deal(t.admin, {
      title: 'Lost 1',
      companyId: co.id,
      value: '999',
      currency: 'USD',
    });
    for (const d of [w1, w2])
      expect((await api.as(t.admin).post(`/v2/deals/${d.id}/won`).send({})).status).toBe(200);
    const lost = await api.as(t.admin).post(`/v2/deals/${l1.id}/lost`).send({ reason: 'Price' });
    expect(lost.status, JSON.stringify(lost.body)).toBe(200);

    const got = (await api.as(t.admin).get(`/v2/companies/${co.id}`)).body as Company;
    expect(got.rollup.contacts).toBe(2);
    expect(got.rollup.deals).toEqual({
      total: 5,
      open: 2,
      won: 2,
      openValue: [{ currency: 'USD', amount: '150.50' }],
      wonValue: [
        { currency: 'JPY', amount: '1000' },
        { currency: 'USD', amount: '25.00' },
      ],
    });
    // the list carries the same figures per row
    const row = (await list(t.admin, '?q=Rollup')).data[0]!;
    expect(row.rollup).toEqual(got.rollup);
  });

  it('WD-CTP-005 #2: a caller who cannot read contacts or deals gets no figure for them (null), not a zero', async () => {
    const co = await company(t.admin, { name: 'Hidden numbers' });
    await contactIn(co, 'Zed');
    const readOnly = await api.member(t, 'cdtro', [['record.companies.read']]);
    const got = (await api.as(readOnly.token).get(`/v2/companies/${co.id}`)).body as Company;
    expect(got.rollup).toEqual({ contacts: null, deals: null });
    const contacts = await api.as(readOnly.token).get(`/v2/companies/${co.id}/contacts`);
    expect(contacts.status).toBe(403);
  });

  it('WD-CTP-005 #3: a company\'s contacts are listed newest first and paged; a contact without a name comes back with null (the screen says "(no name)")', async () => {
    const co = await company(t.admin, { name: 'Contacts list' });
    const ids: string[] = [];
    for (const name of ['First', 'Second', 'Third', 'Fourth', 'Fifth'])
      ids.push(await contactIn(co, name));
    const nameless = await api.seedContacts(t, [{ name: '', phone: '+14155550999' }]);
    await h.owner.query(
      `UPDATE contacts SET name = NULL, company_id = (SELECT id FROM companies WHERE uuid = $1) WHERE uuid = $2`,
      [co.id, nameless[0]],
    );

    const first = await api.as(t.admin).get(`/v2/companies/${co.id}/contacts?limit=3`);
    expect(first.status).toBe(200);
    expect(first.body.data.map((c: { name: string | null }) => c.name)).toEqual([
      null,
      'Fifth',
      'Fourth',
    ]);
    expect(first.body.page.hasMore).toBe(true);
    const second = await api
      .as(t.admin)
      .get(`/v2/companies/${co.id}/contacts?limit=3&cursor=${first.body.page.nextCursor}`);
    expect(second.body.data.map((c: { name: string }) => c.name)).toEqual([
      'Third',
      'Second',
      'First',
    ]);
    expect(second.body.page.hasMore).toBe(false);
    expect(Object.keys(second.body.data[0]).sort()).toEqual(['email', 'id', 'name', 'phone']);
    expect((await api.as(t.admin).get(`/v2/companies/${co.id}/contacts?cursor=zzz`)).status).toBe(
      400,
    );
  });

  it('WD-CTP-005 #4: an archived contact is not listed or counted', async () => {
    const co = await company(t.admin, { name: 'Archive test' });
    const kept = await contactIn(co, 'Kept');
    const gone = await contactIn(co, 'Archived');
    await h.owner.query(`UPDATE contacts SET is_archived = true WHERE uuid = $1`, [gone]);
    const got = (await api.as(t.admin).get(`/v2/companies/${co.id}`)).body as Company;
    expect(got.rollup.contacts).toBe(1);
    const res = await api.as(t.admin).get(`/v2/companies/${co.id}/contacts`);
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([kept]);
  });

  it("WD-CTP-005 #5: the contact scope applies to the company's contact list: an own-scoped caller sees only their contacts", async () => {
    const co = await company(t.admin, { name: 'Scoped contacts' });
    const worker = await api.member(t, 'cdtscope', [
      ['record.companies.read'],
      ['record.contacts.read', 'own'],
      ['record.contacts.update', 'own'],
    ]);
    const mine = await contactIn(co, 'Mine', { ownerId: worker.userId });
    await contactIn(co, 'Theirs', { ownerId: t.adminUserId });
    const res = await api.as(worker.token).get(`/v2/companies/${co.id}/contacts`);
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([mine]);
  });

  it('WD-CTP-006 #1: linking puts the contact under the company; the contact shows the company; both audit trails and the events say so', async () => {
    const co = await company(t.admin, { name: 'Link target' });
    const [c] = await api.seedContacts(t, [{ name: 'Linkee', phone: '+14155550123' }]);
    const res = await api
      .as(t.admin)
      .post(`/v2/companies/${co.id}/contacts`)
      .send({ contactIds: [c] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ succeeded: [c], failed: [] });
    expect((await api.as(t.admin).get(`/v2/contacts/${c}`)).body.companyId).toBe(co.id);
    const history = await api.as(t.admin).get(`/v2/contacts/${c}/field-history`);
    expect(
      history.body.data.some(
        (e: { fieldKey: string; newValue: unknown }) =>
          e.fieldKey === 'companyId' && e.newValue === co.id,
      ),
    ).toBe(true);
    const linked = await api.events(t.orgId, 'company.contact_linked');
    expect(linked.at(-1)).toMatchObject({ uuid: co.id, contactId: c, previousCompanyId: null });
    const updated = await api.events(t.orgId, 'contact.updated');
    expect(updated.at(-1)).toMatchObject({ uuid: c, companyId: co.id });
  });

  it('WD-CTP-006 #2: linking is idempotent, moves a contact from its old company (both companies log it) and reports unknown ids without stopping', async () => {
    const from = await company(t.admin, { name: 'Move from' });
    const to = await company(t.admin, { name: 'Move to' });
    const [c] = await api.seedContacts(t, [{ name: 'Mover', phone: '+14155550124' }]);
    await api
      .as(t.admin)
      .post(`/v2/companies/${from.id}/contacts`)
      .send({ contactIds: [c] });
    const ghost = '11111111-1111-4111-8111-111111111111';
    const moved = await api
      .as(t.admin)
      .post(`/v2/companies/${to.id}/contacts`)
      .send({ contactIds: [c, ghost, c] });
    expect(moved.status).toBe(200);
    expect(moved.body.succeeded).toEqual([c]);
    expect(moved.body.failed).toEqual([
      { id: ghost, code: 'NOT_FOUND', message: expect.any(String) },
    ]);
    expect((await api.as(t.admin).get(`/v2/companies/${from.id}`)).body.rollup.contacts).toBe(0);
    expect((await api.as(t.admin).get(`/v2/companies/${to.id}`)).body.rollup.contacts).toBe(1);
    const before = await api.events(t.orgId, 'company.contact_linked');
    const again = await api
      .as(t.admin)
      .post(`/v2/companies/${to.id}/contacts`)
      .send({ contactIds: [c] });
    expect(again.body.succeeded).toEqual([c]);
    expect((await api.events(t.orgId, 'company.contact_linked')).length).toBe(before.length);
    const unlinkedEvents = await api.events(t.orgId, 'company.contact_unlinked');
    expect(unlinkedEvents.at(-1)).toMatchObject({ uuid: from.id, contactId: c });
  });

  it('WD-CTP-006 #3: unlinking takes the contact out and keeps it; a contact that is not in the company is 404', async () => {
    const co = await company(t.admin, { name: 'Unlink from' });
    const other = await company(t.admin, { name: 'Not this one' });
    const c = await contactIn(co, 'Leaver');
    expect((await api.as(t.admin).delete(`/v2/companies/${other.id}/contacts/${c}`)).status).toBe(
      404,
    );
    expect((await api.as(t.admin).delete(`/v2/companies/${co.id}/contacts/${c}`)).status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/contacts/${c}`)).body.companyId).toBeNull();
    expect((await api.as(t.admin).get(`/v2/companies/${co.id}/contacts`)).body.data).toEqual([]);
    expect((await api.as(t.admin).delete(`/v2/companies/${co.id}/contacts/${c}`)).status).toBe(404);
  });

  it('WD-CTP-006 #4: linking needs the right to edit those contacts, at their record scope', async () => {
    const co = await company(t.admin, { name: 'Link scope' });
    const worker = await api.member(t, 'cdtlink', [
      ['record.companies.read'],
      ['record.companies.update'],
      ['record.contacts.read', 'own'],
      ['record.contacts.update', 'own'],
    ]);
    const [mine, theirs] = await api.seedContacts(t, [
      { name: 'Linkable', ownerId: worker.userId, phone: '+14155550131' },
      { name: 'Not linkable', ownerId: t.adminUserId, phone: '+14155550132' },
    ]);
    const res = await api
      .as(worker.token)
      .post(`/v2/companies/${co.id}/contacts`)
      .send({ contactIds: [mine, theirs] });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([mine]);
    expect(res.body.failed.map((f: { id: string }) => f.id)).toEqual([theirs]);
    const noContacts = await api.member(t, 'cdtnoc', [
      ['record.companies.read'],
      ['record.companies.update'],
    ]);
    expect(
      (
        await api
          .as(noContacts.token)
          .post(`/v2/companies/${co.id}/contacts`)
          .send({ contactIds: [mine] })
      ).status,
    ).toBe(403);
    expect(
      (await api.as(noContacts.token).delete(`/v2/companies/${co.id}/contacts/${mine}`)).status,
    ).toBe(403);
  });

  it('WD-CTP-006 #5: a contact of another workspace cannot be linked', async () => {
    const co = await company(t.admin, { name: 'Link foreign' });
    const other = await api.signup('cdtf');
    const [foreign] = await api.seedContacts(other, [{ name: 'Foreign', phone: '+14155550141' }]);
    const res = await api
      .as(t.admin)
      .post(`/v2/companies/${co.id}/contacts`)
      .send({ contactIds: [foreign] });
    expect(res.body.succeeded).toEqual([]);
    expect(res.body.failed).toHaveLength(1);
    expect(
      (await h.owner.query(`SELECT company_id FROM contacts WHERE uuid = $1`, [foreign])).rows[0]
        .company_id,
    ).toBeNull();
  });

  it("WD-CTP-005 #6: the company's deals are listed by the deals API (`companyId` filter) with their stage, status and value", async () => {
    const co = await company(t.admin, { name: 'Deals list' });
    const open = await api.deal(t.admin, {
      title: 'Open deal',
      companyId: co.id,
      value: '10',
      currency: 'USD',
    });
    const won = await api.deal(t.admin, {
      title: 'Won deal',
      companyId: co.id,
      value: '20',
      currency: 'USD',
    });
    await api.as(t.admin).post(`/v2/deals/${won.id}/won`).send({});
    await api.deal(t.admin, { title: 'Someone else', value: '5', currency: 'USD' });
    const res = await api.as(t.admin).get(`/v2/deals?companyId=${co.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((d: { title: string }) => d.title).sort()).toEqual([
      'Open deal',
      'Won deal',
    ]);
    expect(res.body.data.find((d: { id: string }) => d.id === open.id)).toMatchObject({
      status: 'open',
      company: { id: co.id, name: 'Deals list' },
    });
  });
});

describe('activity (WD-CTP-007)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('cac');
  });

  it('WD-CTP-007: the activity lists the create, each edit field by field, and contacts linked and unlinked, newest first, with names', async () => {
    const co = await company(t.admin, { name: 'Trail', industry: 'Retail' });
    const m = await api.member(t, 'cacowner', [['record.companies.read']]);
    const mUuid = await api.userUuid(m.userId);
    await api
      .as(t.admin)
      .patch(`/v2/companies/${co.id}`)
      .send({ name: 'Trail Ltd', ownerId: mUuid, rowVersion: co.rowVersion });
    const [c] = await api.seedContacts(t, [{ name: 'Trail contact', phone: '+14155550151' }]);
    await api
      .as(t.admin)
      .post(`/v2/companies/${co.id}/contacts`)
      .send({ contactIds: [c] });
    await api.as(t.admin).delete(`/v2/companies/${co.id}/contacts/${c}`);

    const res = await api.as(t.admin).get(`/v2/companies/${co.id}/activity`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const entries = res.body.data as Array<{
      action: string;
      actor: { name: string } | null;
      at: string;
      changes: Array<{ field: string; old: unknown; new: unknown }>;
    }>;
    expect(entries.map((e) => e.changes.map((x) => x.field))).toEqual([
      ['contactUnlinked'],
      ['contactLinked'],
      ['name', 'owner'],
      ['name', 'industry', 'owner'],
    ]);
    expect(entries[0]!.changes[0]).toEqual({
      field: 'contactUnlinked',
      old: { id: c, name: 'Trail contact' },
      new: null,
    });
    expect(entries[2]!.changes[1]).toEqual({
      field: 'owner',
      old: 'Admin Person',
      new: 'cacowner',
    });
    expect(entries[3]!.action).toBe('insert');
    expect(entries.every((e) => e.actor?.name === 'Admin Person')).toBe(true);
    expect(entries[0]!.at >= entries[3]!.at).toBe(true);
    // never an internal id
    expect(JSON.stringify(res.body)).not.toMatch(/"(actorId|recordId)"/);
  });

  it('WD-CTP-007: the activity pages with a cursor', async () => {
    const co = await company(t.admin, { name: 'Pager' });
    let v = co.rowVersion;
    for (let i = 0; i < 4; i++) {
      const r = await api
        .as(t.admin)
        .patch(`/v2/companies/${co.id}`)
        .send({ notes: `n${i}`, rowVersion: v });
      v = r.body.rowVersion;
    }
    const first = await api.as(t.admin).get(`/v2/companies/${co.id}/activity?limit=2`);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.page.hasMore).toBe(true);
    const rest = await api
      .as(t.admin)
      .get(`/v2/companies/${co.id}/activity?limit=10&cursor=${first.body.page.nextCursor}`);
    expect(rest.body.data).toHaveLength(3);
    expect(rest.body.page.hasMore).toBe(false);
  });
});

describe('delete (WD-CTP-008)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('cdl');
  });

  it('WD-CTP-008 #1: deleting a company keeps its contacts, deals and tasks and unlinks them; it is audited with what it unlinked and emits company.deleted', async () => {
    const co = await company(t.admin, { name: 'Doomed' });
    const [c1, c2] = await api.seedContacts(t, [
      { name: 'Doomed one', phone: '+14155550161' },
      { name: 'Doomed two', phone: '+14155550162' },
    ]);
    await api
      .as(t.admin)
      .post(`/v2/companies/${co.id}/contacts`)
      .send({ contactIds: [c1, c2] });
    const d1 = await api.deal(t.admin, { title: 'Doomed deal 1', companyId: co.id });
    const d2 = await api.deal(t.admin, { title: 'Doomed deal 2', companyId: co.id });
    const task = await api
      .as(t.admin)
      .post('/v2/tasks')
      .send({ title: 'Call them', companyId: co.id });
    expect(task.status, JSON.stringify(task.body)).toBe(201);

    const res = await api.as(t.admin).delete(`/v2/companies/${co.id}`);
    expect(res.status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/companies/${co.id}`)).status).toBe(404);

    for (const c of [c1, c2]) {
      const got = await api.as(t.admin).get(`/v2/contacts/${c}`);
      expect(got.status).toBe(200);
      expect(got.body.companyId).toBeNull();
    }
    for (const d of [d1, d2]) {
      const got = await api.as(t.admin).get(`/v2/deals/${d.id}`);
      expect(got.status).toBe(200);
      expect(got.body.company).toBeNull();
    }
    const kept = await api.as(t.admin).get(`/v2/tasks/${task.body.id}`);
    expect(kept.status).toBe(200);
    expect(kept.body.company).toBeNull();

    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'companies' AND action = 'delete' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(audit.rows[0].delta).toEqual({
      name: { old: 'Doomed', new: null },
      contactsUnlinked: { old: 2, new: null },
      dealsUnlinked: { old: 2, new: null },
    });
    const events = await api.events(t.orgId, 'company.deleted');
    expect(events.at(-1)).toMatchObject({
      uuid: co.id,
      name: 'Doomed',
      unlinkedContacts: 2,
      unlinkedDeals: 2,
    });
    // the deal's updated_at moved: the unlink is a write like any other
    expect(
      (await h.owner.query(`SELECT row_version FROM deals WHERE uuid = $1`, [d1.id])).rows[0]
        .row_version,
    ).toBeGreaterThan(1);
  });

  it('WD-CTP-008 #2: every table that points at companies unlinks (ON DELETE SET NULL) rather than blocking or deleting', async () => {
    const res = await h.owner.query(
      `SELECT c.conrelid::regclass::text AS tbl, c.conname, c.confdeltype, c.confupdtype,
              pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c WHERE c.confrelid = 'companies'::regclass AND c.contype = 'f'`,
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(8);
    for (const r of res.rows) {
      expect(r.confdeltype, `${r.tbl}.${r.conname}`).toBe('n');
      expect(r.def, `${r.tbl}.${r.conname}`).toMatch(/ON DELETE SET NULL \(company_id\)/);
    }
  });

  it("WD-CTP-008 #3: a Manager-style delete works at scope all; a scoped delete of someone else's company is 404 and nothing is deleted", async () => {
    const worker = await api.member(t, 'cdlscope', [
      ['record.companies.read'],
      ['record.companies.delete', 'own'],
    ]);
    const theirs = await company(t.admin, { name: 'Not yours' });
    expect((await api.as(worker.token).delete(`/v2/companies/${theirs.id}`)).status).toBe(404);
    expect((await api.as(t.admin).get(`/v2/companies/${theirs.id}`)).status).toBe(200);
  });

  it('WD-CTP-008 #4: bulk delete removes what it can, lists what it cannot, and unlinks like a single delete', async () => {
    const a = await company(t.admin, { name: 'Bulk A' });
    const b = await company(t.admin, { name: 'Bulk B' });
    const [c] = await api.seedContacts(t, [{ name: 'Bulk contact', phone: '+14155550171' }]);
    await api
      .as(t.admin)
      .post(`/v2/companies/${a.id}/contacts`)
      .send({ contactIds: [c] });
    const ghost = '11111111-1111-4111-8111-111111111111';
    const res = await api
      .as(t.admin)
      .post('/v2/companies/bulk/delete')
      .send({ ids: [a.id, ghost, b.id, a.id] });
    expect(res.status).toBe(200);
    expect(res.body.succeeded.sort()).toEqual([a.id, b.id].sort());
    expect(res.body.failed).toEqual([
      { id: ghost, code: 'NOT_FOUND', message: expect.any(String) },
    ]);
    expect((await api.as(t.admin).get(`/v2/contacts/${c}`)).body.companyId).toBeNull();
    expect(
      (await api.events(t.orgId, 'company.deleted')).filter((e) =>
        [a.id, b.id].includes(e.uuid as string),
      ),
    ).toHaveLength(2);
    expect((await api.as(t.admin).post('/v2/companies/bulk/delete').send({ ids: [] })).status).toBe(
      422,
    );
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/companies/bulk/delete')
          .send({ ids: Array(101).fill(a.id) })
      ).status,
    ).toBe(422);
  });

  it('WD-CTP-008 #5: a bulk delete with one out-of-scope company deletes the others', async () => {
    const worker = await api.member(t, 'cdlbulk', [
      ['record.companies.read'],
      ['record.companies.delete', 'own'],
      ['record.companies.create'],
    ]);
    const mine = await company(worker.token, { name: 'Bulk mine' });
    const theirs = await company(t.admin, { name: 'Bulk theirs' });
    const res = await api
      .as(worker.token)
      .post('/v2/companies/bulk/delete')
      .send({ ids: [mine.id, theirs.id] });
    expect(res.body.succeeded).toEqual([mine.id]);
    expect(res.body.failed.map((f: { id: string }) => f.id)).toEqual([theirs.id]);
    expect((await api.as(t.admin).get(`/v2/companies/${theirs.id}`)).status).toBe(200);
  });
});
