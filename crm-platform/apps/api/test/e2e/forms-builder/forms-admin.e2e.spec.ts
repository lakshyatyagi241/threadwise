import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FORMS_READ,
  FORMS_WRITE,
  FormsApi,
  contactDefinition,
  field,
  startHarness,
  type Harness,
  type Tenant,
} from './support';

/**
 * The Forms admin API against a real Postgres, Redis and the real app (docs/specs/forms-builder-app.md 7.1): the plan gate, permissions and
 * record scope, CRUD, the draft/publish/version lifecycle, the publish checks, the picker's catalogue, settings validation and tenant
 * isolation. Test names carry the rule they cover.
 */
let h: Harness;
let api: FormsApi;
let t: Tenant;

beforeAll(async () => {
  h = await startHarness();
  api = new FormsApi(h);
  t = await api.workspace('adm');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('the plan gate (the Forms add-on is sold, not included)', () => {
  it('a workspace without the add-on is refused 422 PLAN_FEATURE_LOCKED on every admin route, reads included, and its public key is a 404', async () => {
    const locked = await api.locked('lock');
    const own = await api.workspace('own');
    const form = await api.liveForm(own.admin);
    for (const [method, path] of [
      ['get', '/v2/forms'],
      ['get', '/v2/forms/templates'],
      ['get', '/v2/forms/meta/properties?object=contact'],
      ['get', `/v2/forms/${form.id}`],
      ['get', `/v2/forms/${form.id}/submissions`],
      ['post', '/v2/forms'],
      ['post', `/v2/forms/${form.id}/publish`],
    ] as const) {
      const res = await api.as(locked.admin)[method](path).send({});
      expect(res.status, `${method} ${path}`).toBe(422);
      expect(res.body.code, path).toBe('PLAN_FEATURE_LOCKED');
    }
    // A lapse: the add-on goes, the data stays, the public form closes (one 404), a renewal restores everything.
    await api.setOverrides(own.orgId, { features: { form_builder: false } });
    expect((await api.as(own.admin).get('/v2/forms')).body.code).toBe('PLAN_FEATURE_LOCKED');
    const gone = await api.publicGet(form.publicKey);
    expect(gone.status).toBe(404);
    expect(
      (await api.submit(form.publicKey, { answers: { name: 'A', email: 'a@x.test' } })).status,
    ).toBe(404);
    expect(await api.rows(own.orgId, `SELECT 1 FROM web_forms WHERE org_id = $1`)).toHaveLength(1);
    await api.enable(own.orgId);
    expect((await api.as(own.admin).get('/v2/forms')).body.data).toHaveLength(1);
    expect((await api.publicGet(form.publicKey)).status).toBe(200);
  });
});

describe('permissions and record scope', () => {
  it('a member with no grants is refused 403; a reader reads but cannot write; each action has its own key', async () => {
    const form = await api.createForm(t.admin);
    const nobody = await api.member(t, 'nobody', []);
    expect((await api.as(nobody.token).get('/v2/forms')).status).toBe(403);
    const reader = await api.member(t, 'reader', FORMS_READ);
    expect((await api.as(reader.token).get('/v2/forms')).status).toBe(200);
    expect((await api.as(reader.token).get(`/v2/forms/${form.id}`)).status).toBe(200);
    expect((await api.as(reader.token).post('/v2/forms').send({ name: 'No' })).status).toBe(403);
    expect(
      (await api.as(reader.token).patch(`/v2/forms/${form.id}`).send({ rowVersion: 1, name: 'No' }))
        .status,
    ).toBe(403);
    expect(
      (await api.as(reader.token).post(`/v2/forms/${form.id}/publish`).send({ rowVersion: 1 }))
        .status,
    ).toBe(403);
    expect((await api.as(reader.token).delete(`/v2/forms/${form.id}`)).status).toBe(403);
    const maker = await api.member(t, 'maker', [['record.forms.read'], ['record.forms.create']]);
    expect(
      (
        await api
          .as(maker.token)
          .post('/v2/forms')
          .send({ name: `Maker ${Date.now()}` })
      ).status,
    ).toBe(201);
    expect(
      (
        await api
          .as(maker.token)
          .post(`/v2/forms/${form.id}/publish`)
          .send({ rowVersion: form.rowVersion })
      ).status,
    ).toBe(403);
    expect(
      (
        await api
          .as(maker.token)
          .post(`/v2/forms/${form.id}/rotate-key`)
          .send({ rowVersion: form.rowVersion })
      ).status,
    ).toBe(403);
  });

  it('record scope `own`: a member sees and changes only the forms they created; other forms do not exist for them', async () => {
    const mine = await api.member(
      t,
      'ownscope',
      FORMS_WRITE.map(([k]) => [k, 'own'] as [string, 'own']),
    );
    const theirs = await api.createForm(t.admin, { name: `Admin form ${Date.now()}` });
    const made = await api.createForm(mine.token, { name: `Own form ${Date.now()}` });
    const list = (await api.as(mine.token).get('/v2/forms')).body.data as Array<{ id: string }>;
    expect(list.map((f) => f.id)).toContain(made.id);
    expect(list.map((f) => f.id)).not.toContain(theirs.id);
    expect((await api.as(mine.token).get(`/v2/forms/${theirs.id}`)).status).toBe(404);
    expect(
      (
        await api
          .as(mine.token)
          .patch(`/v2/forms/${theirs.id}`)
          .send({ rowVersion: 1, name: 'Mine now' })
      ).status,
    ).toBe(404);
    expect((await api.as(mine.token).delete(`/v2/forms/${theirs.id}`)).status).toBe(404);
    expect((await api.as(mine.token).get(`/v2/forms/${made.id}`)).status).toBe(200);
    // The admin (scope all) sees both.
    const all = (await api.as(t.admin).get('/v2/forms?limit=200')).body.data as Array<{
      id: string;
    }>;
    expect(all.map((f) => f.id)).toEqual(expect.arrayContaining([made.id, theirs.id]));
  });
});

describe('create, read, update, delete', () => {
  it('creates blank, from a template and from a definition; the key is 22 characters; share links are built from the web and API origins', async () => {
    const blank = await api
      .as(t.admin)
      .post('/v2/forms')
      .send({ name: `Blank ${Date.now()}` });
    expect(blank.status).toBe(201);
    expect(blank.body).toMatchObject({
      status: 'draft',
      publishedVersion: null,
      hasUnpublishedChanges: true,
      rowVersion: 1,
    });
    expect(blank.body.draft.steps[0].blocks.map((b: { id: string }) => b.id)).toEqual([
      'name',
      'email',
    ]);
    expect(blank.body.publicKey).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(blank.body.share.hostedUrl).toBe(`http://localhost:3001/f/${blank.body.publicKey}`);
    expect(blank.body.share.embedScriptUrl).toBe(
      `http://localhost:3999/form-embed/${blank.body.publicKey}/embed.js`,
    );
    expect(blank.body.share.scriptSnippet).toContain(`data-forms-key="${blank.body.publicKey}"`);
    expect(blank.body.share.iframeSnippet).toContain(`/f/${blank.body.publicKey}?embed=1`);
    expect(blank.body.settings).toMatchObject({
      captchaMode: 'inherit',
      honeypot: true,
      retentionDays: 365,
      allowedOrigins: [],
    });
    expect(blank.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(blank.body)).not.toMatch(/"id":\s*\d+/);

    const tpl = await api
      .as(t.admin)
      .post('/v2/forms')
      .send({ name: `Tpl ${Date.now()}`, templateKey: 'event-registration' });
    expect(tpl.status).toBe(201);
    expect(tpl.body.draft.title).toBe('Register for the event');
    const unknown = await api
      .as(t.admin)
      .post('/v2/forms')
      .send({ name: `Tpl2 ${Date.now()}`, templateKey: 'nope' });
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe('FORMS_TEMPLATE_UNKNOWN');

    const withDef = await api.createForm(t.admin);
    expect(withDef.draft.steps[0].blocks).toHaveLength(6);
    const both = await api
      .as(t.admin)
      .post('/v2/forms')
      .send({ name: 'Both', templateKey: 'survey', definition: contactDefinition() });
    expect(both.status).toBe(422);
  });

  it('refuses an invalid definition with FORMS-shaped details (VALIDATION_FAILED, one path per problem)', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/forms')
      .send({
        name: `Bad ${Date.now()}`,
        definition: {
          title: 'T',
          steps: [
            {
              id: 'a',
              blocks: [field('x', 'dropdown'), field('x', 'short_text', { style: 'color:red' })],
            },
          ],
        },
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body)).toContain('options_required');
  });

  it('a name is unique among the active forms in any case: 409 FORMS_NAME_TAKEN; an archived form frees its name', async () => {
    const name = `Unique ${Date.now()}`;
    const first = await api.createForm(t.admin, { name });
    const dup = await api.as(t.admin).post('/v2/forms').send({ name: name.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('FORMS_NAME_TAKEN');
    const renameTo = await api.createForm(t.admin);
    const clash = await api
      .as(t.admin)
      .patch(`/v2/forms/${renameTo.id}`)
      .send({ rowVersion: renameTo.rowVersion, name });
    expect(clash.body.code).toBe('FORMS_NAME_TAKEN');
    await api
      .as(t.admin)
      .post(`/v2/forms/${first.id}/archive`)
      .send({ rowVersion: first.rowVersion });
    expect((await api.as(t.admin).post('/v2/forms').send({ name })).status).toBe(201);
  });

  it('the plan caps active forms (422 PLAN_LIMIT_REACHED with the standard fields); archiving frees a place', async () => {
    const capped = await api.workspace('cap', { forms: 2 });
    const a = await api.createForm(capped.admin);
    await api.createForm(capped.admin);
    const over = await api.as(capped.admin).post('/v2/forms').send({ name: 'Third' });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(over.body.details ?? over.body.errors ?? []).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'limit', message: 'forms' })]),
    );
    expect(
      (
        await api
          .as(capped.admin)
          .post(`/v2/forms/${a.id}/duplicate`)
          .send({ rowVersion: a.rowVersion })
      ).status,
    ).toBe(422);
    await api.as(capped.admin).post(`/v2/forms/${a.id}/archive`).send({ rowVersion: a.rowVersion });
    expect((await api.as(capped.admin).post('/v2/forms').send({ name: 'Third' })).status).toBe(201);
    // Bringing the archived one back takes a place again.
    const back = await api
      .as(capped.admin)
      .post(`/v2/forms/${a.id}/resume`)
      .send({ rowVersion: a.rowVersion + 1 });
    expect(back.status).toBe(422);
  });

  it('update takes the row version read (409 ROW_VERSION_CONFLICT when stale), sanitises rich text, and never changes what is live', async () => {
    const form = await api.liveForm(t.admin);
    const edited = await api.patchForm(t.admin, form, {
      definition: contactDefinition({
        description:
          '<p>Hi <script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a></p>',
        settings: { successMessage: '<p onclick="x()">Done</p>' },
      }),
    });
    expect(edited.rowVersion).toBe(form.rowVersion + 1);
    expect(edited.hasUnpublishedChanges).toBe(true);
    expect(edited.publishedVersion).toBe(1);
    expect(JSON.stringify(edited.draft)).not.toMatch(/<script|onerror|javascript:|onclick/);
    expect(edited.draft.description).toContain('Hi');
    const stale = await api
      .as(t.admin)
      .patch(`/v2/forms/${form.id}`)
      .send({ rowVersion: form.rowVersion, name: 'Stale' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    expect(
      (await api.as(t.admin).patch(`/v2/forms/${form.id}`).send({ name: 'No version' })).status,
    ).toBe(422);
    // The public still sees the version that was published, not the edit.
    const pub = (await api.publicGet(form.publicKey)).body;
    expect(pub.version).toBe(1);
    expect(pub.description).toBeNull();
  });

  it('settings: origins are normalised, users must be active members of THIS workspace, rules are shape-checked', async () => {
    const form = await api.createForm(t.admin);
    const ok = await api.patchForm(t.admin, form, {
      settings: {
        allowedOrigins: ['HTTPS://Shop.Example.com/', 'https://*.partner.io'],
        captchaMode: 'on',
        honeypot: false,
        retentionDays: 90,
      },
    });
    expect(ok.settings).toMatchObject({
      allowedOrigins: ['https://shop.example.com', 'https://*.partner.io'],
      captchaMode: 'on',
      honeypot: false,
      retentionDays: 90,
    });
    const bad = await api
      .as(t.admin)
      .patch(`/v2/forms/${ok.id}`)
      .send({ rowVersion: ok.rowVersion, settings: { allowedOrigins: ['*'] } });
    expect(bad.status).toBe(422);
    const other = await api.signup('foreign');
    const foreignUser = await api.userUuid(other.adminUserId);
    const stranger = await api
      .as(t.admin)
      .patch(`/v2/forms/${ok.id}`)
      .send({
        rowVersion: ok.rowVersion,
        settings: { ownerRule: { mode: 'fixed', userIds: [foreignUser] } },
      });
    expect(stranger.status).toBe(422);
    expect(JSON.stringify(stranger.body)).toContain('unknown_user');
    const me = await api.userUuid(t.adminUserId);
    const fixed = await api.patchForm(t.admin, ok, {
      settings: {
        ownerRule: { mode: 'fixed', userIds: [me] },
        notify: { owner: false, userIds: [me], emails: ['Boss@Example.com'] },
      },
    });
    expect(fixed.settings.ownerRule).toEqual({ mode: 'fixed', userIds: [me] });
    expect(fixed.settings.notify.emails).toEqual(['boss@example.com']);
    const roundRobin = await api
      .as(t.admin)
      .patch(`/v2/forms/${fixed.id}`)
      .send({
        rowVersion: fixed.rowVersion,
        settings: { ownerRule: { mode: 'round_robin', userIds: [me] } },
      });
    expect(roundRobin.status).toBe(422);
  });

  it('delete: only a draft or an archived form, for good, with everything that belongs to it', async () => {
    const live = await api.liveForm(t.admin);
    const refuse = await api.as(t.admin).delete(`/v2/forms/${live.id}`);
    expect(refuse.status).toBe(409);
    expect(refuse.body.code).toBe('FORMS_STATE_INVALID');
    await api.submit(live.publicKey, { answers: { name: 'Ann', email: 'ann-del@x.test' } });
    await api
      .as(t.admin)
      .post(`/v2/forms/${live.id}/archive`)
      .send({ rowVersion: live.rowVersion + 0 });
    const current = (await api.as(t.admin).get(`/v2/forms/${live.id}`)).body;
    expect(current.status).toBe('archived');
    expect((await api.as(t.admin).delete(`/v2/forms/${live.id}`)).status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/forms/${live.id}`)).status).toBe(404);
    expect(
      await api.rows(
        t.orgId,
        `SELECT 1 FROM web_form_submissions s JOIN web_form_versions v ON v.org_id = s.org_id AND v.id = s.version_id WHERE s.org_id = $1 AND v.form_id NOT IN (SELECT id FROM web_forms WHERE org_id = $1)`,
      ),
    ).toEqual([]);
    // The contact the submission made is an ordinary CRM record and stays.
    expect(await api.contactByEmail(t.orgId, 'ann-del@x.test')).toBeTruthy();
    expect(await api.eventsOfType(t.orgId, 'form.deleted')).not.toHaveLength(0);
  });

  it('list: cursor paging, status and name filters, archived hidden unless asked for, counts of what came in', async () => {
    const w = await api.workspace('lst');
    const names = ['Alpha', 'Beta', 'Gamma'];
    const forms = [];
    for (const n of names) forms.push(await api.createForm(w.admin, { name: `${n} form` }));
    await api.publish(w.admin, forms[0]!);
    await api
      .as(w.admin)
      .post(`/v2/forms/${forms[2]!.id}/archive`)
      .send({ rowVersion: forms[2]!.rowVersion });
    const page1 = (await api.as(w.admin).get('/v2/forms?limit=1')).body;
    expect(page1.data).toHaveLength(1);
    expect(page1.page.hasMore).toBe(true);
    const page2 = (await api.as(w.admin).get(`/v2/forms?limit=5&cursor=${page1.page.nextCursor}`))
      .body;
    expect(page2.data.length).toBe(1);
    expect(page2.page.hasMore).toBe(false);
    const all = (await api.as(w.admin).get('/v2/forms')).body.data as Array<{
      name: string;
      status: string;
    }>;
    expect(all.map((f) => f.name)).toEqual(['Beta form', 'Alpha form']);
    expect(
      (await api.as(w.admin).get('/v2/forms?status=archived')).body.data.map(
        (f: { name: string }) => f.name,
      ),
    ).toEqual(['Gamma form']);
    expect((await api.as(w.admin).get('/v2/forms?includeArchived=true')).body.data).toHaveLength(3);
    expect(
      (await api.as(w.admin).get('/v2/forms?status=published')).body.data.map(
        (f: { name: string }) => f.name,
      ),
    ).toEqual(['Alpha form']);
    expect(
      (await api.as(w.admin).get('/v2/forms?q=bet')).body.data.map((f: { name: string }) => f.name),
    ).toEqual(['Beta form']);
    const key = (await api.as(w.admin).get(`/v2/forms/${forms[0]!.id}`)).body.publicKey as string;
    await api.submit(key, { answers: { name: 'Ann', email: 'ann-lst@x.test' } });
    const row = (await api.as(w.admin).get('/v2/forms?status=published')).body.data[0];
    expect(row).toMatchObject({
      submissions: 1,
      needsReview: 0,
      publishedVersion: 1,
      hasUnpublishedChanges: false,
    });
    expect(row.lastSubmissionAt).toBeTruthy();
  });
});

describe('draft, publish, versions and the public key', () => {
  it('publish checks the form and lists every problem as path: reason (422 FORMS_PUBLISH_INVALID); nothing goes live', async () => {
    const w = await api.workspace('pub');
    await api.property(w.orgId, 'contacts', 'budget', 'integer', { required: true });
    const form = await api.createForm(w.admin, {
      definition: {
        title: 'No way to reach',
        steps: [
          {
            id: 'main',
            blocks: [
              field('name', 'short_text', { bind: { object: 'contact', property: 'name' } }),
              field('ghost', 'short_text', { bind: { object: 'contact', property: 'nope' } }),
            ],
          },
        ],
      },
    });
    const res = await api
      .as(w.admin)
      .post(`/v2/forms/${form.id}/publish`)
      .send({ rowVersion: form.rowVersion });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('FORMS_PUBLISH_INVALID');
    const problems = (res.body.details ?? res.body.errors) as Array<{
      path: string;
      message: string;
    }>;
    expect(problems).toEqual(
      expect.arrayContaining([
        { path: 'steps', message: 'no_contact_point' },
        { path: 'contact.budget', message: 'crm_required_unbound' },
        { path: 'steps.0.blocks.1.bind', message: 'bind_unknown_property' },
      ]),
    );
    expect((await api.as(w.admin).get(`/v2/forms/${form.id}`)).body.status).toBe('draft');
    expect((await api.publicGet(form.publicKey)).status).toBe(404);
  });

  it('a required workspace property that the form collects and requires lets it publish; a lifecycle stage that does not exist does not', async () => {
    const w = await api.workspace('pub2');
    await api.property(w.orgId, 'contacts', 'budget', 'integer', { required: true });
    const def = contactDefinition();
    def.steps[0]!.blocks.push(
      field('budget', 'number', {
        required: true,
        bind: { object: 'contact', property: 'budget' },
      }),
    );
    const form = await api.createForm(w.admin, { definition: def });
    expect(
      (
        await api
          .as(w.admin)
          .post(`/v2/forms/${form.id}/publish`)
          .send({ rowVersion: form.rowVersion })
      ).status,
    ).toBe(200);
    const staged = await api.createForm(w.admin, {
      definition: { ...contactDefinition(), after: { tags: [], lifecycleStage: 'not_a_stage' } },
    });
    const bad = await api
      .as(w.admin)
      .post(`/v2/forms/${staged.id}/publish`)
      .send({ rowVersion: staged.rowVersion });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain('lifecycle_stage_unknown');
  });

  it('publish freezes a version; publishing the same draft again changes nothing; an edit marks it unpublished; the next publish is version 2; history and restore', async () => {
    const form = await api.createForm(t.admin);
    const v1 = await api.publish(t.admin, form);
    expect(v1).toMatchObject({
      status: 'published',
      publishedVersion: 1,
      hasUnpublishedChanges: false,
    });
    const again = await api.publish(t.admin, v1);
    expect(again.rowVersion).toBe(v1.rowVersion);
    expect(again.publishedVersion).toBe(1);
    const edited = await api.patchForm(t.admin, v1, {
      definition: contactDefinition({ title: 'Second title' }),
    });
    expect(edited.hasUnpublishedChanges).toBe(true);
    const v2 = await api.publish(t.admin, edited);
    expect(v2.publishedVersion).toBe(2);
    const versions = (await api.as(t.admin).get(`/v2/forms/${form.id}/versions`)).body.data;
    expect(
      versions.map((v: { version: number; isLive: boolean }) => [v.version, v.isLive]),
    ).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(versions[0].publishedBy).toMatchObject({ name: expect.any(String) });
    const restored = await api
      .as(t.admin)
      .post(`/v2/forms/${form.id}/versions/1/restore`)
      .send({ rowVersion: v2.rowVersion });
    expect(restored.status).toBe(200);
    expect(restored.body.draft.title).toBe('Get in touch');
    expect(restored.body.publishedVersion).toBe(2);
    expect(restored.body.hasUnpublishedChanges).toBe(true);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/forms/${form.id}/versions/9/restore`)
          .send({ rowVersion: restored.body.rowVersion })
      ).body.code,
    ).toBe('FORMS_VERSION_UNKNOWN');
    // A frozen version cannot be edited, even by the database owner.
    await expect(
      h.owner.query(`UPDATE web_form_versions SET definition = '{}'::jsonb WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).rejects.toThrow(/immutable/);
  });

  it('pause, resume, archive: the public page follows; an archived form is read-only and can come back', async () => {
    const live = await api.liveForm(t.admin);
    const paused = await api
      .as(t.admin)
      .post(`/v2/forms/${live.id}/pause`)
      .send({ rowVersion: live.rowVersion });
    expect(paused.body.status).toBe('paused');
    expect((await api.publicGet(live.publicKey)).body).toMatchObject({ closed: true, steps: [] });
    expect(
      (await api.submit(live.publicKey, { answers: { name: 'A', email: 'a@x.test' } })).status,
    ).toBe(404);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/forms/${live.id}/pause`)
          .send({ rowVersion: paused.body.rowVersion })
      ).body.code,
    ).toBe('FORMS_STATE_INVALID');
    const resumed = await api
      .as(t.admin)
      .post(`/v2/forms/${live.id}/resume`)
      .send({ rowVersion: paused.body.rowVersion });
    expect(resumed.body.status).toBe('published');
    expect((await api.publicGet(live.publicKey)).body.closed).toBe(false);
    const archived = await api
      .as(t.admin)
      .post(`/v2/forms/${live.id}/archive`)
      .send({ rowVersion: resumed.body.rowVersion });
    expect(archived.body.status).toBe('archived');
    expect((await api.publicGet(live.publicKey)).status).toBe(404);
    const edit = await api
      .as(t.admin)
      .patch(`/v2/forms/${live.id}`)
      .send({ rowVersion: archived.body.rowVersion, name: 'Nope' });
    expect(edit.body.code).toBe('FORMS_STATE_INVALID');
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/forms/${live.id}/publish`)
          .send({ rowVersion: archived.body.rowVersion })
      ).body.code,
    ).toBe('FORMS_STATE_INVALID');
    const back = await api
      .as(t.admin)
      .post(`/v2/forms/${live.id}/resume`)
      .send({ rowVersion: archived.body.rowVersion });
    expect(back.body.status).toBe('published');
    expect((await api.publicGet(live.publicKey)).status).toBe(200);
  });

  it('rotate-key: the old URL, embed and submit answer 404 at once; the new key works', async () => {
    const live = await api.liveForm(t.admin);
    const rotated = await api
      .as(t.admin)
      .post(`/v2/forms/${live.id}/rotate-key`)
      .send({ rowVersion: live.rowVersion });
    expect(rotated.status).toBe(200);
    expect(rotated.body.publicKey).not.toBe(live.publicKey);
    expect((await api.publicGet(live.publicKey)).status).toBe(404);
    expect(
      (await api.submit(live.publicKey, { answers: { name: 'A', email: 'a@x.test' } })).status,
    ).toBe(404);
    expect((await api.publicGet(rotated.body.publicKey)).status).toBe(200);
    expect(rotated.body.share.hostedUrl).toContain(rotated.body.publicKey);
  });

  it('duplicate: a copy under a free name with its own key, draft and settings, not published; independent of the original', async () => {
    const live = await api.liveForm(t.admin, { name: `Orig ${Date.now()}` });
    const patched = await api.patchForm(t.admin, live, {
      settings: { allowedOrigins: ['https://dup.example.com'], retentionDays: 60 },
    });
    const copy = await api
      .as(t.admin)
      .post(`/v2/forms/${live.id}/duplicate`)
      .send({ rowVersion: patched.rowVersion });
    expect(copy.status).toBe(201);
    expect(copy.body.name).toBe(`Copy of ${live.name}`);
    expect(copy.body).toMatchObject({ status: 'draft', publishedVersion: null });
    expect(copy.body.publicKey).not.toBe(live.publicKey);
    expect(copy.body.settings).toMatchObject({
      allowedOrigins: ['https://dup.example.com'],
      retentionDays: 60,
    });
    expect(copy.body.draft.title).toBe('Get in touch');
    const second = await api
      .as(t.admin)
      .post(`/v2/forms/${live.id}/duplicate`)
      .send({ rowVersion: patched.rowVersion });
    expect(second.body.name).toBe(`Copy of ${live.name} 2`);
    expect((await api.publicGet(copy.body.publicKey)).status).toBe(404);
  });
});

describe('templates and the field picker catalogue', () => {
  it('the gallery has the five templates, each a valid definition', async () => {
    const res = await api.as(t.admin).get('/v2/forms/templates');
    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { key: string }) => x.key)).toEqual([
      'lead-capture',
      'contact-us',
      'event-registration',
      'order-request',
      'survey',
    ]);
    for (const tpl of res.body.data) expect(tpl.definition.steps).toHaveLength(1);
  });

  it('every template can be created and published in a fresh workspace', async () => {
    const w = await api.workspace('tpl');
    for (const key of [
      'lead-capture',
      'contact-us',
      'event-registration',
      'order-request',
      'survey',
    ]) {
      const f = await api
        .as(w.admin)
        .post('/v2/forms')
        .send({ name: `From ${key}`, templateKey: key });
      expect(f.status, key).toBe(201);
      const pub = await api
        .as(w.admin)
        .post(`/v2/forms/${f.body.id}/publish`)
        .send({ rowVersion: f.body.rowVersion });
      expect(pub.status, `${key}: ${JSON.stringify(pub.body)}`).toBe(200);
    }
  });

  it('properties: built-ins plus the active, writable custom properties of the registry, typed, with options; nothing a visitor must not set', async () => {
    const w = await api.workspace('cat');
    await api.property(w.orgId, 'contacts', 'budget', 'integer', { required: true });
    await api.property(w.orgId, 'contacts', 'plan_choice', 'select', { options: ['basic', 'pro'] });
    await api.property(w.orgId, 'contacts', 'score_calc', 'formula');
    await api.property(w.orgId, 'contacts', 'owner_lookup', 'lookup');
    await api.property(w.orgId, 'companies', 'segment', 'text');
    await h.owner.query(
      `INSERT INTO fields (org_id, module_key, key, label, field_type, is_active) VALUES ($1,'contacts','old_field','Old','text',false)`,
      [w.orgId],
    );
    await h.owner.query(
      `INSERT INTO fields (org_id, module_key, key, label, field_type, is_read_only) VALUES ($1,'contacts','locked','Locked','text',true)`,
      [w.orgId],
    );
    await h.owner.query(
      `INSERT INTO fields (org_id, module_key, key, label, field_type, is_system) VALUES ($1,'contacts','sys_field','Sys','text',true)`,
      [w.orgId],
    );
    const contact = (await api.as(w.admin).get('/v2/forms/meta/properties?object=contact')).body
      .data as Array<Record<string, unknown>>;
    const keys = contact.map((p) => p.property);
    expect(keys).toEqual(
      expect.arrayContaining([
        'name',
        'first_name',
        'last_name',
        'email',
        'phone',
        'title',
        'address',
        'message',
        'budget',
        'plan_choice',
      ]),
    );
    for (const banned of [
      'score_calc',
      'owner_lookup',
      'old_field',
      'locked',
      'sys_field',
      'owner',
      'lifecycle_stage',
      'tags',
    ])
      expect(keys, banned).not.toContain(banned);
    expect(contact.find((p) => p.property === 'budget')).toMatchObject({
      source: 'custom',
      type: 'integer',
      suggestedKind: 'number',
      requiredByWorkspace: true,
    });
    expect(contact.find((p) => p.property === 'plan_choice')).toMatchObject({
      type: 'select',
      suggestedKind: 'dropdown',
      options: [
        { value: 'basic', label: 'basic' },
        { value: 'pro', label: 'pro' },
      ],
    });
    expect(contact.find((p) => p.property === 'email')).toMatchObject({
      source: 'builtin',
      suggestedKind: 'email',
      object: 'contact',
    });
    const company = (await api.as(w.admin).get('/v2/forms/meta/properties?object=company')).body
      .data as Array<Record<string, unknown>>;
    expect(company.map((p) => p.property)).toEqual(
      expect.arrayContaining(['name', 'domain', 'industry', 'size_range', 'segment']),
    );
    expect(company.map((p) => p.property)).not.toContain('budget');
    expect((await api.as(w.admin).get('/v2/forms/meta/properties?object=deal')).status).toBe(422);
  });
});

describe('tenant isolation', () => {
  it('another workspace cannot read, change, publish, export or open the submissions of a form: 404 (and its own key is not usable across)', async () => {
    const a = await api.workspace('isoa');
    const b = await api.workspace('isob');
    const form = await api.liveForm(a.admin);
    const sub = await api.submit(form.publicKey, {
      answers: { name: 'Ann', email: 'ann-iso@x.test' },
    });
    expect(sub.status).toBe(201);
    const rows = await api.submissions(a.orgId, form.id);
    expect(rows).toHaveLength(1);
    for (const [method, path, body] of [
      ['get', `/v2/forms/${form.id}`, undefined],
      ['patch', `/v2/forms/${form.id}`, { rowVersion: 1, name: 'X' }],
      ['post', `/v2/forms/${form.id}/publish`, { rowVersion: 1 }],
      ['post', `/v2/forms/${form.id}/archive`, { rowVersion: 1 }],
      ['delete', `/v2/forms/${form.id}`, undefined],
      ['get', `/v2/forms/${form.id}/submissions`, undefined],
      ['get', `/v2/forms/${form.id}/submissions/${rows[0]!.uuid as string}`, undefined],
      ['post', `/v2/forms/${form.id}/submissions/export`, {}],
    ] as const) {
      const req = api.as(b.admin)[method](path);
      const res = body === undefined ? await req : await req.send(body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect((await api.as(b.admin).get('/v2/forms')).body.data).toEqual([]);
    expect(await api.contactCount(b.orgId)).toBe(0);
  });
});
