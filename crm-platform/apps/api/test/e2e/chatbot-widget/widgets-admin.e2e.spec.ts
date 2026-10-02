import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  WidgetApi,
  startHarness,
  uuidRe,
  widgetBody,
  type Harness,
  type Tenant,
  type WidgetJson,
} from './support';

/**
 * The admin side of the chatbot widget end to end through HTTP (WD-WGT-001, 002, 003, 006, 021 to 027): permissions, the
 * save rules, the list and its numbers, duplicate, rotate, pause and delete, with the audit, outbox and tenant properties
 * every write must have. One app, one database; each block works in organizations of its own.
 */
let h: Harness;
let api: WidgetApi;

beforeAll(async () => {
  h = await startHarness();
  api = new WidgetApi(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;

describe('permissions (WD-WGT-027)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('wgp');
  });

  it('WD-WGT-027 #4: without a sign-in every admin route is 401', async () => {
    for (const [verb, path] of [
      ['get', '/v2/widgets'],
      ['get', '/v2/widgets/assistants'],
      ['post', '/v2/widgets'],
    ] as const) {
      const res = await api.http()[verb](path);
      expect(res.status, path).toBe(401);
    }
  });

  it('WD-WGT-027 #2: the organization admin holds every widget key; a member with none is refused with 403', async () => {
    const w = await api.widget(t.admin, { name: 'Admin made' });
    const none = await api.member(t, 'nokeys', [['record.contacts.read']]);
    for (const [verb, path] of [
      ['get', '/v2/widgets'],
      ['get', `/v2/widgets/${w.id}`],
      ['get', '/v2/widgets/assistants'],
    ] as const) {
      const res = await api.as(none.token)[verb](path);
      expect(res.status, path).toBe(403);
    }
    const create = await api.as(none.token).post('/v2/widgets').send(widgetBody());
    expect(create.status).toBe(403);
  });

  it('WD-WGT-027 #3: each action has its own key: read does not create, update, rotate, duplicate or delete', async () => {
    const w = await api.widget(t.admin, { name: 'Keys' });
    const reader = await api.member(t, 'reader', [['wgt.widgets.read']]);
    expect((await api.as(reader.token).get('/v2/widgets')).status).toBe(200);
    expect((await api.as(reader.token).get(`/v2/widgets/${w.id}`)).status).toBe(200);
    expect((await api.as(reader.token).post('/v2/widgets').send(widgetBody())).status).toBe(403);
    expect(
      (
        await api
          .as(reader.token)
          .patch(`/v2/widgets/${w.id}`)
          .send({ ...widgetBody(), rowVersion: 1 })
      ).status,
    ).toBe(403);
    expect((await api.as(reader.token).post(`/v2/widgets/${w.id}/duplicate`)).status).toBe(403);
    expect((await api.as(reader.token).post(`/v2/widgets/${w.id}/rotate-token`)).status).toBe(403);
    expect(
      (
        await api
          .as(reader.token)
          .patch(`/v2/widgets/${w.id}/status`)
          .send({ status: 'paused', rowVersion: 1 })
      ).status,
    ).toBe(403);
    expect((await api.as(reader.token).delete(`/v2/widgets/${w.id}`)).status).toBe(403);

    const maker = await api.member(t, 'maker', [['wgt.widgets.read'], ['wgt.widgets.create']]);
    expect(
      (
        await api
          .as(maker.token)
          .post('/v2/widgets')
          .send(widgetBody({ name: 'Made by maker' }))
      ).status,
    ).toBe(201);
    expect((await api.as(maker.token).post(`/v2/widgets/${w.id}/duplicate`)).status).toBe(201);
    expect((await api.as(maker.token).delete(`/v2/widgets/${w.id}`)).status).toBe(403);
  });
});

describe('save widget (WD-WGT-006)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('wgs');
  });

  it('WD-WGT-006 #1: a valid payload creates a widget with a 48-char token, a slug from the name, status active and both URLs', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/widgets')
      .send(widgetBody({ name: 'Pricing page' }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const w = res.body as WidgetJson;
    expect(w.id).toMatch(uuidRe);
    expect(w.embedToken).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(w.slug).toBe('pricing-page');
    expect(w.status).toBe('active');
    expect(w.embedUrl).toMatch(new RegExp(`/widget/${w.embedToken}/embed$`));
    expect(w.previewUrl).toMatch(new RegExp(`/widget/${w.embedToken}/chat$`));
    expect(w.rowVersion).toBe(1);

    const row = await h.owner.query(
      `SELECT user_id, status FROM chatbot_widgets WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, w.id],
    );
    expect(Number(row.rows[0].user_id)).toBe(t.adminUserId);
    expect(row.rows[0].status).toBe('active');
    // The internal bigint id never reaches the wire.
    expect(JSON.stringify(res.body)).not.toMatch(/"id":\d/);
  });

  it('WD-WGT-006: the builder defaults of WD-WGT-002 survive a round trip', async () => {
    const w = await api.widget(t.admin, { name: 'Defaults' });
    expect(w).toMatchObject({
      mode: 'whatsapp',
      position: 'bottom_right',
      buttonColor: '#075E54',
      headerTitle: 'Chat with us',
      headerBg: '#075E54',
      headerTextColor: '#FFFFFF',
      messageBubbleColor: '#FFFFFF',
      messageTextColor: '#222222',
      bodyBgKind: 'color',
      bodyBgColor: '#ECE5DD',
      autoOpen: false,
      collectName: true,
      collectEmail: false,
      collectPhone: false,
      buttonImageUrl: null,
      bodyBgImageUrl: null,
      allowedDomains: [],
    });
  });

  it('WD-WGT-006 #2: two widgets named Support get the slugs support and support-2', async () => {
    const a = await api.widget(t.admin, { name: 'Support' });
    const b = await api.widget(t.admin, { name: 'Support' });
    expect([a.slug, b.slug]).toEqual(['support', 'support-2']);
  });

  it('WD-WGT-006 rule 6: a name with no Latin letters gets widget-<random>', async () => {
    const w = await api.widget(t.admin, { name: '你好' });
    expect(w.slug).toMatch(/^widget-[a-z0-9]{6}$/);
  });

  it('WD-WGT-006 rule 6: re-creating a widget whose slug belonged to a deleted one works (WaDesk answered 500)', async () => {
    const a = await api.widget(t.admin, { name: 'Reborn' });
    expect((await api.as(t.admin).delete(`/v2/widgets/${a.id}`)).status).toBe(204);
    const b = await api.widget(t.admin, { name: 'Reborn' });
    expect(b.slug).toBe('reborn');
  });

  it('WD-WGT-006 rule 5: every widget has its own token, unique across the whole platform', async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 5; i++)
      tokens.add((await api.widget(t.admin, { name: `Tok ${i}` })).embedToken);
    expect(tokens.size).toBe(5);
    const other = await api.signup('wgs2');
    expect(tokens.has((await api.widget(other.admin)).embedToken)).toBe(false);
  });

  it('WD-WGT-006 #4: allowedDomains is normalised: trimmed, lower-cased, scheme and path stripped, de-duplicated', async () => {
    const w = await api.widget(t.admin, {
      name: 'Domains',
      allowedDomains: ['HTTPS://Acme.com/path', 'acme.com', '', ' Shop.Acme.com '],
    });
    expect(w.allowedDomains).toEqual(['acme.com', 'shop.acme.com']);
  });

  it('WD-WGT-021 #2: more than 50 allowed domains is a 422', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `h${i}.example.com`);
    const res = await api
      .as(t.admin)
      .post('/v2/widgets')
      .send(widgetBody({ allowedDomains: many }));
    expect(res.status).toBe(422);
    expect(code(res)).toBe('VALIDATION_FAILED');
  });

  it('WD-WGT-006: required fields and limits are refused with 422 and a field path', async () => {
    const bad = async (over: Record<string, unknown>, path: string) => {
      const res = await api.as(t.admin).post('/v2/widgets').send(widgetBody(over));
      expect(res.status, path).toBe(422);
      expect(code(res), path).toBe('VALIDATION_FAILED');
      expect(
        res.body.errors.some((e: { path: string }) => e.path === path),
        path,
      ).toBe(true);
    };
    await bad({ name: '' }, 'name');
    await bad({ name: 'x'.repeat(121) }, 'name');
    await bad({ mode: 'sms' }, 'mode');
    await bad({ position: 'top' }, 'position');
    await bad({ bodyBgKind: 'video' }, 'bodyBgKind');
    await bad({ headerTitle: '' }, 'headerTitle');
    await bad({ buttonLabel: 'x'.repeat(81) }, 'buttonLabel');
    await bad({ buttonColor: 'x'.repeat(17) }, 'buttonColor');
    await bad({ welcomeMessage: 'x'.repeat(2001) }, 'welcomeMessage');
    await bad({ buttonImageUrl: `https://x.example/${'a'.repeat(1010)}` }, 'buttonImageUrl');
    await bad({ targetWhatsappCc: '+123456789' }, 'targetWhatsappCc');
    await bad({ targetWhatsappNumber: '1'.repeat(25) }, 'targetWhatsappNumber');
  });

  it('WD-WGT-004 rule 1: a colour that could carry markup is refused (hardening; WaDesk stored any 16 characters)', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/widgets')
      .send(widgetBody({ headerBg: "red';}</s" }));
    expect(res.status).toBe(422);
    const ok = await api
      .as(t.admin)
      .post('/v2/widgets')
      .send(
        widgetBody({
          name: 'Colours',
          headerBg: 'rgb(1, 2, 3)',
          messageBubbleColor: 'white',
          buttonColor: '#abc',
        }),
      );
    expect(ok.status).toBe(201);
  });

  it('WD-WGT-006 #6: a write leaves an audit row and an outbox event; nothing is written when it is refused', async () => {
    const before = await api.auditCount(t.orgId, 'chatbot_widgets', 'insert');
    const w = await api.widget(t.admin, { name: 'Audited' });
    expect(await api.auditCount(t.orgId, 'chatbot_widgets', 'insert')).toBe(before + 1);
    const events = await api.events(t.orgId, 'widget.created');
    expect(events.some((e) => e.uuid === w.id)).toBe(true);
    const nope = await api
      .as(t.admin)
      .post('/v2/widgets')
      .send(widgetBody({ name: '' }));
    expect(nope.status).toBe(422);
    expect(await api.auditCount(t.orgId, 'chatbot_widgets', 'insert')).toBe(before + 1);
  });
});

describe('engine mode, smart agent and WhatsApp target (WD-WGT-003)', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('wgm');
    other = await api.signup('wgm2');
  });

  it('WD-WGT-003 #3: mode ai with no assistant is 422 with the "needs an assistant" message', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/widgets')
      .send(widgetBody({ mode: 'ai', assistantId: null }));
    expect(res.status).toBe(422);
    expect(code(res)).toBe('WGT_ASSISTANT_REQUIRED');
    expect(res.body.detail).toBe(
      'AI mode needs an assistant. Pick one or create one in AI Training.',
    );
    const both = await api
      .as(t.admin)
      .post('/v2/widgets')
      .send(widgetBody({ mode: 'both' }));
    expect(code(both)).toBe('WGT_ASSISTANT_REQUIRED');
  });

  it("WD-WGT-003 #4: another workspace's assistant is 422 'Assistant not in this workspace.'", async () => {
    const foreign = await api.assistant(other, { name: 'Foreign' });
    const res = await api
      .as(t.admin)
      .post('/v2/widgets')
      .send(widgetBody({ mode: 'ai', assistantId: foreign.uuid }));
    expect(res.status).toBe(422);
    expect(code(res)).toBe('WGT_ASSISTANT_NOT_IN_WORKSPACE');
    expect(res.body.detail).toBe('Assistant not in this workspace.');
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/widgets')
          .send(widgetBody({ mode: 'ai', assistantId: crypto.randomUUID() }))
      ).status,
    ).toBe(422);
  });

  it('WD-WGT-003 rule 3: an assistant of this workspace is accepted whatever its status', async () => {
    const paused = await api.assistant(t, { name: 'Sleeping', status: 'paused' });
    const w = await api.widget(t.admin, { name: 'Linked', mode: 'ai', assistantId: paused.uuid });
    expect(w.assistantId).toBe(paused.uuid);
  });

  it('WD-WGT-003 rule 2: whatsapp mode saves without a number (only the browser requires it)', async () => {
    const w = await api.widget(t.admin, {
      name: 'No number',
      mode: 'whatsapp',
      targetWhatsappNumber: '',
      targetWhatsappCc: '',
    });
    expect(w.targetWhatsappNumber).toBeNull();
  });

  it('WD-WGT-003 #2: the cc and the national digits are stored as sent (+91 and 9876543210)', async () => {
    const w = await api.widget(t.admin, {
      name: 'Both',
      mode: 'both',
      assistantId: (await api.assistant(t)).uuid,
    });
    expect(w.targetWhatsappCc).toBe('+91');
    expect(w.targetWhatsappNumber).toBe('9876543210');
  });

  it('WD-WGT-003 rule 4: the fields of the engine not in use are still stored', async () => {
    const a = await api.assistant(t);
    const w = await api.widget(t.admin, { name: 'Unused', mode: 'ai', assistantId: a.uuid });
    expect(w.targetWhatsappNumber).toBe('9876543210');
  });

  it('WD-WGT-001 #5 builder: the assistant picker lists only active assistants of the workspace, by name', async () => {
    const x = await api.signup('wgm3');
    await api.assistant(x, { name: 'Zed' });
    await api.assistant(x, { name: 'Alpha' });
    await api.assistant(x, { name: 'Dormant', status: 'paused' });
    await api.assistant(other, { name: 'Elsewhere' });
    const res = await api.as(x.admin).get('/v2/widgets/assistants');
    expect(res.status).toBe(200);
    expect(res.body.data.map((a: { name: string }) => a.name)).toEqual(['Alpha', 'Zed']);
    expect(res.body.planLocked).toBe(false);
    expect(res.body.data[0].id).toMatch(uuidRe);
  });

  it('WD-WGT-029 #1: deleting an assistant leaves the widget and clears its assistant', async () => {
    const a = await api.assistant(t, { name: 'Doomed' });
    const w = await api.widget(t.admin, { name: 'Orphan', mode: 'ai', assistantId: a.uuid });
    await h.owner.query(`DELETE FROM ai_chat_assistants WHERE org_id = $1 AND id = $2`, [
      t.orgId,
      a.id,
    ]);
    const res = await api.as(t.admin).get(`/v2/widgets/${w.id}`);
    expect(res.status).toBe(200);
    expect(res.body.assistantId).toBeNull();
    expect(res.body.mode).toBe('ai');
  });
});

describe('update (WD-WGT-006 rules 4, 7, 8)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('wgu');
  });

  it("WD-WGT-006 #5: an id that is not this workspace's is 404, never a new widget (WaDesk created one)", async () => {
    const other = await api.signup('wgu2');
    const foreign = await api.widget(other.admin, { name: 'Foreign' });
    const before = await api.count(`SELECT count(*)::int AS n FROM chatbot_widgets`);
    const res = await api
      .as(t.admin)
      .patch(`/v2/widgets/${foreign.id}`)
      .send({ ...widgetBody({ name: 'Hijack' }), rowVersion: 1 });
    expect(res.status).toBe(404);
    expect(await api.count(`SELECT count(*)::int AS n FROM chatbot_widgets`)).toBe(before);
    const still = await api.as(other.admin).get(`/v2/widgets/${foreign.id}`);
    expect(still.body.name).toBe('Foreign');
    const missing = await api
      .as(t.admin)
      .patch(`/v2/widgets/${crypto.randomUUID()}`)
      .send({ ...widgetBody(), rowVersion: 1 });
    expect(missing.status).toBe(404);
  });

  it('WD-WGT-006 rule 6: a renamed widget keeps its slug and its token', async () => {
    const w = await api.widget(t.admin, { name: 'First name' });
    const res = await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}`)
      .send({ ...widgetBody({ name: 'Second name' }), rowVersion: w.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.name).toBe('Second name');
    expect(res.body.slug).toBe('first-name');
    expect(res.body.embedToken).toBe(w.embedToken);
    expect(res.body.rowVersion).toBe(w.rowVersion + 1);
  });

  it('WD-WGT-006: a stale rowVersion is 409 ROW_VERSION_CONFLICT and nothing changes', async () => {
    const w = await api.widget(t.admin, { name: 'Raced' });
    const first = await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}`)
      .send({ ...widgetBody({ name: 'Winner' }), rowVersion: w.rowVersion });
    expect(first.status).toBe(200);
    const stale = await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}`)
      .send({ ...widgetBody({ name: 'Loser' }), rowVersion: w.rowVersion });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    expect((await api.as(t.admin).get(`/v2/widgets/${w.id}`)).body.name).toBe('Winner');
  });

  it('WD-WGT-006 rule 8 / WD-WGT-021 #3: flags and the allow-list are only overwritten when sent', async () => {
    const w = await api.widget(t.admin, {
      name: 'Flags',
      autoOpen: true,
      collectEmail: true,
      collectPhone: true,
      collectName: false,
      allowedDomains: ['acme.com'],
    });
    const res = await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}`)
      .send({ ...widgetBody({ name: 'Flags 2' }), rowVersion: w.rowVersion });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      autoOpen: true,
      collectEmail: true,
      collectPhone: true,
      collectName: false,
      allowedDomains: ['acme.com'],
    });
    const off = await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}`)
      .send({
        ...widgetBody({
          name: 'Flags 3',
          autoOpen: false,
          collectEmail: false,
          allowedDomains: [],
        }),
        rowVersion: res.body.rowVersion,
      });
    expect(off.body).toMatchObject({
      autoOpen: false,
      collectEmail: false,
      collectPhone: true,
      allowedDomains: [],
    });
  });

  it('WD-WGT-006 rule 7: status and the token cannot be set through a save', async () => {
    const w = await api.widget(t.admin, { name: 'Locked down' });
    const res = await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}`)
      .send({
        ...widgetBody(),
        status: 'paused',
        embedToken: 'x'.repeat(48),
        rowVersion: w.rowVersion,
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.embedToken).toBe(w.embedToken);
  });

  it('WD-WGT-006: an update is audited with the settings that changed', async () => {
    const w = await api.widget(t.admin, { name: 'Delta', position: 'bottom_right' });
    await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}`)
      .send({
        ...widgetBody({ name: 'Delta', position: 'bottom_left' }),
        rowVersion: w.rowVersion,
      });
    const res = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'chatbot_widgets' AND action = 'update' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(res.rows[0].delta.position).toEqual({ old: 'bottom_right', new: 'bottom_left' });
  });
});

describe('list, stats and tenant isolation (WD-WGT-001)', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('wgl');
    other = await api.signup('wgl2');
  });

  it('WD-WGT-001 #1: 25 widgets: 20 rows newest first, then the remaining 5 on the next page', async () => {
    for (let i = 1; i <= 25; i++)
      await api.widget(t.admin, { name: `W${String(i).padStart(2, '0')}` });
    const p1 = await api.as(t.admin).get('/v2/widgets');
    expect(p1.status).toBe(200);
    expect(p1.body.data).toHaveLength(20);
    expect(p1.body.data[0].name).toBe('W25');
    expect(p1.body.data[19].name).toBe('W06');
    expect(p1.body.page.hasMore).toBe(true);
    const p2 = await api.as(t.admin).get(`/v2/widgets?cursor=${p1.body.page.nextCursor}`);
    expect(p2.body.data.map((w: { name: string }) => w.name)).toEqual([
      'W05',
      'W04',
      'W03',
      'W02',
      'W01',
    ]);
    expect(p2.body.page.hasMore).toBe(false);
    expect(p1.body.stats).toEqual(p2.body.stats);
    expect(p1.body.stats.total).toBe(25);
  });

  it('WD-WGT-001: each row carries its assistant name, its visitors and both addresses', async () => {
    const x = await api.signup('wgl3');
    const a = await api.assistant(x, { name: 'Helper' });
    const w = await api.widget(x.admin, { name: 'Rows', mode: 'ai', assistantId: a.uuid });
    await api.visitor(w.embedToken);
    await api.visitor(w.embedToken);
    const res = await api.as(x.admin).get('/v2/widgets');
    const row = res.body.data[0];
    expect(row.assistant).toEqual({ id: a.uuid, name: 'Helper' });
    expect(row.visitors).toBe(2);
    expect(row.embedUrl).toBe(w.embedUrl);
    expect(res.body.stats).toEqual({ total: 1, active: 1, visitors: 2 });
  });

  it('WD-WGT-001 #3: an empty workspace lists nothing and every number is zero', async () => {
    const x = await api.signup('wgl4');
    const res = await api.as(x.admin).get('/v2/widgets');
    expect(res.body.data).toEqual([]);
    expect(res.body.stats).toEqual({ total: 0, active: 0, visitors: 0 });
    expect(res.body.planLocked).toBe(false);
  });

  it('WD-WGT-001 rule 2 / WD-WGT-026: the status filter returns only that status; stats ignore it', async () => {
    const x = await api.signup('wgl5');
    const a = await api.widget(x.admin, { name: 'A' });
    await api.widget(x.admin, { name: 'B' });
    await api
      .as(x.admin)
      .patch(`/v2/widgets/${a.id}/status`)
      .send({ status: 'paused', rowVersion: a.rowVersion });
    const paused = await api.as(x.admin).get('/v2/widgets?status=paused');
    expect(paused.body.data.map((w: { name: string }) => w.name)).toEqual(['A']);
    const active = await api.as(x.admin).get('/v2/widgets?status=active');
    expect(active.body.data.map((w: { name: string }) => w.name)).toEqual(['B']);
    expect(paused.body.stats).toEqual({ total: 2, active: 1, visitors: 0 });
    expect((await api.as(x.admin).get('/v2/widgets?status=weird')).status).toBe(422);
  });

  it("WD-WGT-001 rule 1: one workspace never sees, reads or touches another's widgets", async () => {
    const mine = await api.widget(t.admin, { name: 'Private to t' });
    const list = await api.as(other.admin).get('/v2/widgets');
    expect(list.body.data.some((w: { id: string }) => w.id === mine.id)).toBe(false);
    expect((await api.as(other.admin).get(`/v2/widgets/${mine.id}`)).status).toBe(404);
    expect((await api.as(other.admin).delete(`/v2/widgets/${mine.id}`)).status).toBe(404);
    expect((await api.as(other.admin).post(`/v2/widgets/${mine.id}/duplicate`)).status).toBe(404);
    expect((await api.as(other.admin).post(`/v2/widgets/${mine.id}/rotate-token`)).status).toBe(
      404,
    );
    expect(
      (
        await api
          .as(other.admin)
          .patch(`/v2/widgets/${mine.id}/status`)
          .send({ status: 'paused', rowVersion: 1 })
      ).status,
    ).toBe(404);
    expect((await api.as(t.admin).get(`/v2/widgets/${mine.id}`)).body.status).toBe('active');
  });

  it('WD-WGT-001: a malformed id is a 400 and a bad cursor is refused', async () => {
    expect((await api.as(t.admin).get('/v2/widgets/not-a-uuid')).status).toBe(400);
    expect((await api.as(t.admin).get('/v2/widgets?cursor=%%%')).status).toBeGreaterThanOrEqual(
      400,
    );
  });
});

describe('duplicate (WD-WGT-024)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('wgd');
  });

  it('WD-WGT-024 #1: "Pricing" becomes "Pricing (copy)" with slug pricing-copy-xxxx and a different token', async () => {
    const src = await api.widget(t.admin, {
      name: 'Pricing',
      headerTitle: 'Hello',
      autoOpen: true,
      allowedDomains: ['acme.com'],
    });
    const res = await api.as(t.admin).post(`/v2/widgets/${src.id}/duplicate`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const copy = res.body as WidgetJson;
    expect(copy.name).toBe('Pricing (copy)');
    expect(copy.slug).toMatch(/^pricing-copy-[A-Za-z0-9]{4}$/);
    expect(copy.embedToken).not.toBe(src.embedToken);
    expect(copy.id).not.toBe(src.id);
    expect(copy).toMatchObject({
      headerTitle: 'Hello',
      autoOpen: true,
      allowedDomains: ['acme.com'],
      mode: 'whatsapp',
    });
  });

  it('WD-WGT-024 #3: the copy has no visitors', async () => {
    const src = await api.widget(t.admin, { name: 'Visited' });
    await api.visitor(src.embedToken);
    const copy = (await api.as(t.admin).post(`/v2/widgets/${src.id}/duplicate`)).body as WidgetJson;
    const list = await api.as(t.admin).get('/v2/widgets?limit=100');
    expect(list.body.data.find((w: { id: string }) => w.id === copy.id).visitors).toBe(0);
    expect(list.body.data.find((w: { id: string }) => w.id === src.id).visitors).toBe(1);
  });

  it('WD-WGT-024 rule 1: a name at the 120-character limit is cut so the copy still saves', async () => {
    const src = await api.widget(t.admin, { name: 'n'.repeat(120) });
    const res = await api.as(t.admin).post(`/v2/widgets/${src.id}/duplicate`);
    expect(res.status).toBe(201);
    expect(res.body.name.length).toBe(120);
    expect(res.body.name.endsWith(' (copy)')).toBe(true);
  });

  it('WD-WGT-024: the copy is authored by the caller, not by the original author', async () => {
    const src = await api.widget(t.admin, { name: 'Author' });
    const maker = await api.member(t, 'dupmaker', [['wgt.widgets.read'], ['wgt.widgets.create']]);
    const copy = (await api.as(maker.token).post(`/v2/widgets/${src.id}/duplicate`))
      .body as WidgetJson;
    const row = await h.owner.query(
      `SELECT user_id FROM chatbot_widgets WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, copy.id],
    );
    expect(Number(row.rows[0].user_id)).toBe(maker.userId);
  });

  it('WD-WGT-024 rule 2: a paused widget is copied as paused', async () => {
    const src = await api.widget(t.admin, { name: 'Sleepy' });
    await api
      .as(t.admin)
      .patch(`/v2/widgets/${src.id}/status`)
      .send({ status: 'paused', rowVersion: src.rowVersion });
    const copy = (await api.as(t.admin).post(`/v2/widgets/${src.id}/duplicate`)).body as WidgetJson;
    expect(copy.status).toBe('paused');
  });
});

describe('rotate the embed token (WD-WGT-023)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('wgr');
  });

  it('WD-WGT-023 #1: after a rotation the old embed and chat addresses are 404 and the new ones work', async () => {
    const w = await api.widget(t.admin, { name: 'Rotating' });
    expect((await api.pub(w.embedToken).embed()).status).toBe(200);
    const res = await api.as(t.admin).post(`/v2/widgets/${w.id}/rotate-token`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.embedToken).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(res.body.embedToken).not.toBe(w.embedToken);
    expect(res.body.embedUrl).toMatch(new RegExp(`/widget/${res.body.embedToken}/embed$`));
    const old = api.pub(w.embedToken);
    expect((await old.embed()).status).toBe(404);
    expect((await old.chat()).status).toBe(404);
    expect((await old.config()).status).toBe(404);
    expect((await old.history('a'.repeat(36))).status).toBe(404);
    expect((await old.message({ body: 'hi' })).status).toBe(404);
    const fresh = api.pub(res.body.embedToken);
    expect((await fresh.embed()).status).toBe(200);
    expect((await fresh.chat()).status).toBe(200);
  });

  it('WD-WGT-023 #3: existing conversations stay and the visitor keeps their thread under the new token', async () => {
    const w = await api.widget(t.admin, { name: 'Keeps threads' });
    const uuid = await api.visitor(w.embedToken);
    expect(
      (await api.pub(w.embedToken).message({ body: 'before', visitor_uuid: uuid })).status,
    ).toBe(200);
    const res = await api.as(t.admin).post(`/v2/widgets/${w.id}/rotate-token`);
    const after = await api.pub(res.body.embedToken).config(uuid);
    expect(after.body.visitor.uuid).toBe(uuid);
    expect(after.body.transcript.map((m: { body: string }) => m.body)).toContain('before');
    expect(
      await api.count(
        `SELECT count(*)::int AS n FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
         WHERE c.org_id = $1 AND ch.kind = 'webchat'`,
        [t.orgId],
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it('WD-WGT-023: the rotation is audited and the old token is never written into the trail', async () => {
    const w = await api.widget(t.admin, { name: 'Traced' });
    await api.as(t.admin).post(`/v2/widgets/${w.id}/rotate-token`);
    const events = await api.events(t.orgId, 'widget.token_rotated');
    expect(events.some((e) => e.uuid === w.id)).toBe(true);
    const audit = await h.owner.query(
      `SELECT delta::text AS d FROM audit_log WHERE org_id = $1 AND module = 'chatbot_widgets'`,
      [t.orgId],
    );
    expect(audit.rows.some((r) => String(r.d).includes(w.embedToken))).toBe(false);
  });
});

describe('pause and resume (WD-WGT-026)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('wgx');
  });

  it('WD-WGT-026 #1: a paused widget answers 404 on embed, chat, config, message and history; resuming restores it', async () => {
    const w = await api.widget(t.admin, { name: 'Pausable' });
    const uuid = await api.visitor(w.embedToken);
    const pub = api.pub(w.embedToken);
    const paused = await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}/status`)
      .send({ status: 'paused', rowVersion: w.rowVersion });
    expect(paused.status).toBe(200);
    expect(paused.body.status).toBe('paused');
    expect((await pub.embed()).status).toBe(404);
    expect((await pub.embed()).text).toContain('widget not found or paused');
    expect((await pub.chat()).status).toBe(404);
    expect((await pub.config(uuid)).status).toBe(404);
    expect((await pub.message({ body: 'hi', visitor_uuid: uuid })).status).toBe(404);
    expect((await pub.history(uuid)).status).toBe(404);
    const resumed = await api
      .as(t.admin)
      .patch(`/v2/widgets/${w.id}/status`)
      .send({ status: 'active', rowVersion: paused.body.rowVersion });
    expect(resumed.body.status).toBe('active');
    expect((await pub.embed()).status).toBe(200);
    expect((await pub.config(uuid)).status).toBe(200);
  });

  it('WD-WGT-026: a stale rowVersion or an unknown status is refused', async () => {
    const w = await api.widget(t.admin, { name: 'Strict' });
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/widgets/${w.id}/status`)
          .send({ status: 'paused', rowVersion: 99 })
      ).status,
    ).toBe(409);
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/widgets/${w.id}/status`)
          .send({ status: 'gone', rowVersion: 1 })
      ).status,
    ).toBe(422);
  });
});

describe('delete (WD-WGT-025, 029)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('wgx2');
  });

  it('WD-WGT-025 #1: a deleted widget stops serving at once and leaves the list', async () => {
    const w = await api.widget(t.admin, { name: 'Short lived' });
    expect((await api.pub(w.embedToken).embed()).status).toBe(200);
    expect((await api.as(t.admin).delete(`/v2/widgets/${w.id}`)).status).toBe(204);
    expect((await api.pub(w.embedToken).embed()).status).toBe(404);
    expect((await api.as(t.admin).get(`/v2/widgets/${w.id}`)).status).toBe(404);
    const list = await api.as(t.admin).get('/v2/widgets?limit=100');
    expect(list.body.data.some((x: { id: string }) => x.id === w.id)).toBe(false);
    expect((await api.as(t.admin).delete(`/v2/widgets/${w.id}`)).status).toBe(404);
  });

  it('WD-WGT-025 #2: past conversations and their contact stay in the inbox', async () => {
    const w = await api.widget(t.admin, { name: 'Leaves history' });
    const uuid = await api.visitor(w.embedToken);
    await api.pub(w.embedToken).message({ body: 'remember me', visitor_uuid: uuid, name: 'Asha' });
    const threadBefore = await api.thread(t.orgId, uuid);
    expect(threadBefore.length).toBeGreaterThan(0);
    await api.as(t.admin).delete(`/v2/widgets/${w.id}`);
    const convs = await h.owner.query(
      `SELECT c.id FROM conversations c WHERE c.org_id = $1 AND c.routing_meta ->> 'visitor_uuid' = $2`,
      [t.orgId, uuid],
    );
    expect(convs.rows).toHaveLength(1);
    const msgs = await h.owner.query(
      `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND conversation_id = $2`,
      [t.orgId, convs.rows[0].id],
    );
    expect(msgs.rows[0].n).toBe(threadBefore.length);
    const contact = await h.owner.query(
      `SELECT name FROM contacts WHERE org_id = $1 AND channel = 'chatbot_widget' AND channel_uid = $2`,
      [t.orgId, uuid],
    );
    expect(contact.rows[0].name).toBe('Asha');
  });

  it('WD-WGT-029: the visitors of a deleted widget go with it; the delete is audited', async () => {
    const w = await api.widget(t.admin, { name: 'Takes visitors along' });
    await api.visitor(w.embedToken);
    const before = await api.count(
      `SELECT count(*)::int AS n FROM chatbot_widget_visitors WHERE org_id = $1`,
      [t.orgId],
    );
    await api.as(t.admin).delete(`/v2/widgets/${w.id}`);
    expect(
      await api.count(`SELECT count(*)::int AS n FROM chatbot_widget_visitors WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(before - 1);
    expect(await api.auditCount(t.orgId, 'chatbot_widgets', 'delete')).toBeGreaterThanOrEqual(1);
    const events = await api.events(t.orgId, 'widget.deleted');
    expect(events.some((e) => e.uuid === w.id)).toBe(true);
  });

  it('WD-WGT-029 #1: hard-deleting a workspace removes its widgets and visitors', async () => {
    const x = await api.signup('wgx3');
    const w = await api.widget(x.admin, { name: 'Goes with the org' });
    await api.visitor(w.embedToken);
    await h.owner.query(`DELETE FROM organizations WHERE id = $1`, [x.orgId]);
    expect(
      await api.count(`SELECT count(*)::int AS n FROM chatbot_widgets WHERE org_id = $1`, [
        x.orgId,
      ]),
    ).toBe(0);
    expect(
      await api.count(`SELECT count(*)::int AS n FROM chatbot_widget_visitors WHERE org_id = $1`, [
        x.orgId,
      ]),
    ).toBe(0);
  });
});
