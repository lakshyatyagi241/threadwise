import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AppointmentsApi,
  bearer,
  freshIp,
  startHarness,
  type BookingType,
  type Harness,
  type Tenant,
} from './support';

/**
 * Booking page appearance end to end through HTTP (BL-355..BL-358): the workspace theme and a service's override, what the public page
 * and the manage page are told, the brand-kit fallback, the white-label gate on "Powered by", the pictures (upload rules and the
 * public address), the cache that must never serve a stale look, tenant isolation, permissions, and the audit and outbox rows.
 */
let h: Harness;
let api: AppointmentsApi;

beforeAll(async () => {
  h = await startHarness();
  api = new AppointmentsApi(h);
}, 600_000);

afterAll(async () => {
  await h?.stop();
});

/** A real 1x1 PNG: the upload policy reads the bytes, not the file name. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const THEME = '/v2/booking-page/theme';

const save = (token: string, body: Record<string, unknown>) =>
  api
    .as(token)
    .put(THEME)
    .send({
      primaryColor: null,
      accentColor: null,
      backgroundColor: null,
      backgroundStyle: null,
      pageTitle: null,
      welcomeText: null,
      buttonLabel: null,
      font: null,
      cornerStyle: null,
      colorMode: null,
      showPoweredBy: null,
      showLanguageSwitch: null,
      useWorkspaceBrand: true,
      rowVersion: null,
      ...body,
    });

const publicPage = (slug: string) =>
  api.http().get(`/v2/public/booking/${slug}`).set('x-forwarded-for', freshIp());
const publicType = (slug: string, typeSlug: string) =>
  api.http().get(`/v2/public/booking/${slug}/${typeSlug}`).set('x-forwarded-for', freshIp());

const upload = (token: string, path: string, buffer: Buffer, filename: string) =>
  api
    .as(token)
    .put(path)
    .set('Idempotency-Key', crypto.randomUUID())
    .attach('file', buffer, filename);

describe('the workspace theme', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('bpt');
    await api.type(t.admin);
  });

  it('starts as the product look with nothing saved, and tells a page with no theme so', async () => {
    const res = await api.as(t.admin).get(THEME);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.scope).toBe('workspace');
    expect(res.body.workspaceSlug).toBe(t.slug);
    expect(res.body.typeSlug).toBeNull();
    expect(res.body.theme.rowVersion).toBeNull();
    expect(res.body.theme.useWorkspaceBrand).toBe(true);
    expect(res.body.resolved).toMatchObject({
      primaryColor: null,
      backgroundStyle: 'solid',
      font: 'default',
      cornerStyle: 'rounded',
      colorMode: 'auto',
      showPoweredBy: true,
      showLanguageSwitch: true,
      logo: null,
      cover: null,
    });
    expect(res.body.limits.welcomeText).toBe(600);
    const page = await publicPage(t.slug);
    expect(page.status).toBe(200);
    expect(page.body.theme).toMatchObject({
      primaryColor: null,
      font: 'default',
      showPoweredBy: true,
    });
  });

  it('saves, answers with the new row version, and the public page shows it at once', async () => {
    // warm the public cache first: the save has to drop it
    expect((await publicPage(t.slug)).body.theme.primaryColor).toBeNull();
    const res = await save(t.admin, {
      primaryColor: '#0B6E4F',
      accentColor: '#f4a300',
      welcomeText: '  Welcome in  ',
      buttonLabel: 'Reserve my spot',
      pageTitle: 'Acme Studio',
      font: 'serif',
      cornerStyle: 'pill',
      colorMode: 'dark',
      showLanguageSwitch: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.theme).toMatchObject({
      primaryColor: '#0b6e4f',
      welcomeText: 'Welcome in',
      rowVersion: 1,
    });
    const page = await publicPage(t.slug);
    expect(page.body.theme).toMatchObject({
      primaryColor: '#0b6e4f',
      accentColor: '#f4a300',
      welcomeText: 'Welcome in',
      buttonLabel: 'Reserve my spot',
      pageTitle: 'Acme Studio',
      font: 'serif',
      cornerStyle: 'pill',
      colorMode: 'dark',
      showLanguageSwitch: false,
    });
  });

  it('a second save needs the version it read: a stale or a missing one is 409', async () => {
    const stale = await save(t.admin, { primaryColor: '#111111', rowVersion: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    const first = await save(t.admin, { primaryColor: '#111111', rowVersion: null });
    expect(first.status).toBe(409);
    const ok = await save(t.admin, { primaryColor: '#111111', rowVersion: 1 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.theme.rowVersion).toBe(2);
  });

  it('refuses anything that is not a plain hex colour, a listed font or a short text', async () => {
    const bad: Array<Record<string, unknown>> = [
      { primaryColor: 'red' },
      { primaryColor: '#fff' },
      { accentColor: 'url(javascript:alert(1))' },
      { backgroundColor: '#000000;background:url(//evil)' },
      { font: 'Comic Sans' },
      { cornerStyle: 'blob' },
      { colorMode: 'sepia' },
      { backgroundStyle: 'video' },
      { welcomeText: 'x'.repeat(601) },
      { buttonLabel: 'x'.repeat(41) },
      { pageTitle: 'x'.repeat(121) },
    ];
    for (const patch of bad) {
      const res = await save(t.admin, { ...patch, rowVersion: 2 });
      expect(res.status, JSON.stringify(patch)).toBe(422);
    }
    expect((await api.as(t.admin).get(THEME)).body.theme.rowVersion).toBe(2);
  });

  it('keeps markup as text: it is stored and served exactly as typed, never interpreted', async () => {
    const text = '<script>alert(1)</script> & "quotes"';
    const res = await save(t.admin, { welcomeText: text, rowVersion: 2 });
    expect(res.status).toBe(200);
    expect((await publicPage(t.slug)).body.theme.welcomeText).toBe(text);
  });

  it('clearing a field makes it inherit again', async () => {
    const cur = (await api.as(t.admin).get(THEME)).body.theme.rowVersion as number;
    const res = await save(t.admin, { rowVersion: cur });
    expect(res.status).toBe(200);
    expect((await publicPage(t.slug)).body.theme).toMatchObject({
      primaryColor: null,
      welcomeText: null,
      font: 'default',
    });
  });

  it('writes an audit row and an outbox event for every change', async () => {
    expect(await api.auditCount(t.orgId, 'booking_page_themes', 'insert')).toBe(1);
    expect(await api.auditCount(t.orgId, 'booking_page_themes', 'update')).toBeGreaterThanOrEqual(
      2,
    );
    expect((await api.events(t.orgId, 'booking_page_theme.updated')).length).toBeGreaterThanOrEqual(
      3,
    );
  });
});

describe('a service override', () => {
  let t: Tenant;
  let a: BookingType;
  let b: BookingType;
  beforeAll(async () => {
    t = await api.signup('bpo');
    a = await api.type(t.admin, { name: 'Alpha' });
    b = await api.type(t.admin, { name: 'Beta' });
    const ws = await save(t.admin, { primaryColor: '#0b6e4f', welcomeText: 'Workspace words' });
    expect(ws.status).toBe(200);
  });

  const typeUrl = (id: string) => `/v2/booking-types/${id}/page-theme`;

  it('inherits the workspace look until it sets something of its own', async () => {
    const res = await api.as(t.admin).get(typeUrl(a.id));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.scope).toBe('type');
    expect(res.body.typeSlug).toBe(a.slug);
    expect(res.body.theme.rowVersion).toBeNull();
    expect(res.body.inherited).toMatchObject({
      primaryColor: '#0b6e4f',
      welcomeText: 'Workspace words',
    });
    expect((await publicType(t.slug, a.slug)).body.theme).toMatchObject({
      primaryColor: '#0b6e4f',
      welcomeText: 'Workspace words',
    });
  });

  it('sets colours and words for one service only', async () => {
    const res = await api.as(t.admin).put(typeUrl(a.id)).send({
      primaryColor: '#aa2200',
      accentColor: null,
      backgroundStyle: null,
      welcomeText: 'Alpha words',
      buttonLabel: 'Book Alpha',
      rowVersion: null,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.theme).toMatchObject({ primaryColor: '#aa2200', rowVersion: 1 });
    expect((await publicType(t.slug, a.slug)).body.theme).toMatchObject({
      primaryColor: '#aa2200',
      welcomeText: 'Alpha words',
      buttonLabel: 'Book Alpha',
    });
    // the other service and the chooser keep the workspace look
    expect((await publicType(t.slug, b.slug)).body.theme).toMatchObject({
      primaryColor: '#0b6e4f',
      welcomeText: 'Workspace words',
      buttonLabel: null,
    });
    expect((await publicPage(t.slug)).body.theme.primaryColor).toBe('#0b6e4f');
  });

  it('cannot set what only the workspace sets (font, corners, mode, footer)', async () => {
    const res = await api.as(t.admin).put(typeUrl(a.id)).send({
      primaryColor: '#aa2200',
      accentColor: null,
      backgroundStyle: null,
      welcomeText: null,
      buttonLabel: null,
      font: 'mono',
      cornerStyle: 'square',
      showPoweredBy: false,
      rowVersion: 1,
    });
    expect(res.status).toBe(200);
    const page = (await publicType(t.slug, a.slug)).body.theme;
    expect(page.font).toBe('default');
    expect(page.cornerStyle).toBe('rounded');
    expect(page.showPoweredBy).toBe(true);
  });

  it('a stale version is 409; an unknown service is 404', async () => {
    const stale = await api
      .as(t.admin)
      .put(typeUrl(a.id))
      .send({
        primaryColor: null,
        accentColor: null,
        backgroundStyle: null,
        welcomeText: null,
        buttonLabel: null,
        rowVersion: 50,
      });
    expect(stale.status).toBe(409);
    const missing = await api.as(t.admin).get(typeUrl('00000000-0000-4000-8000-000000000000'));
    expect(missing.status).toBe(404);
  });

  it('reset deletes the override and its pictures', async () => {
    const up = await upload(t.admin, `${typeUrl(a.id)}/assets/logo`, PNG, 'logo.png');
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.theme.logo).not.toBeNull();
    const res = await api.as(t.admin).delete(typeUrl(a.id));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.theme.rowVersion).toBeNull();
    expect(res.body.theme.logo).toBeNull();
    expect((await publicType(t.slug, a.slug)).body.theme.primaryColor).toBe('#0b6e4f');
    const left = await h.owner.query(
      `SELECT count(*)::int AS n FROM booking_page_assets WHERE org_id = $1`,
      [t.orgId],
    );
    expect(left.rows[0].n).toBe(0);
  });

  it('a manage page is drawn with the look of the booking it belongs to', async () => {
    await api
      .as(t.admin)
      .put(typeUrl(b.id))
      .send({
        primaryColor: '#334455',
        accentColor: null,
        backgroundStyle: null,
        welcomeText: null,
        buttonLabel: null,
        rowVersion: null,
      })
      .expect(200);
    const slots = await api.publicSlots(t.slug, b.slug);
    const booked = await api.publicBooked(t.slug, b.slug, {
      startsAt: slots[0]!.start,
      name: 'Visitor',
      email: 'visitor@example.test',
    });
    const view = await api.manage(booked.manageToken);
    expect(view.status).toBe(200);
    expect(view.body.theme.primaryColor).toBe('#334455');
    expect(view.body.organization.slug).toBe(t.slug);
  });
});

describe('the workspace brand kit', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('bpb');
    await api.type(t.admin);
    await h.owner.query(
      `UPDATE organizations SET settings = settings || jsonb_build_object('branding', jsonb_build_object('primary', '#123456', 'accent', '#fedcba', 'background', 'not-a-colour')) WHERE id = $1`,
      [t.orgId],
    );
  });

  it('fills what the booking theme leaves empty, and ignores a stored value that is not a clean hex', async () => {
    const res = await api.as(t.admin).get(THEME);
    expect(res.body.brand).toMatchObject({
      primary: '#123456',
      accent: '#fedcba',
      background: null,
    });
    // the public cache holds up to two minutes of brand-kit state; a theme save drops it, which is what the owner does next anyway
    expect((await save(t.admin, {})).status).toBe(200);
    expect((await publicPage(t.slug)).body.theme).toMatchObject({
      primaryColor: '#123456',
      accentColor: '#fedcba',
      backgroundColor: null,
    });
  });

  it('is left alone when the workspace says not to use it', async () => {
    const cur = (await api.as(t.admin).get(THEME)).body.theme.rowVersion as number;
    expect((await save(t.admin, { useWorkspaceBrand: false, rowVersion: cur })).status).toBe(200);
    expect((await publicPage(t.slug)).body.theme.primaryColor).toBeNull();
  });

  it('serves the brand kit logo to a visitor only through the booking page, under its own name', async () => {
    await h.owner.query(
      `INSERT INTO workspace_brand_assets (org_id, slot, mime, bytes, etag) VALUES ($1, 'logo', 'image/png', $2, 'abcdef0123456789')`,
      [t.orgId, PNG],
    );
    const cur = (await api.as(t.admin).get(THEME)).body.theme.rowVersion as number;
    expect((await save(t.admin, { useWorkspaceBrand: true, rowVersion: cur })).status).toBe(200);
    const logo = (await publicPage(t.slug)).body.theme.logo;
    expect(logo).toEqual({ id: 'brand-logo', v: 'abcdef0123456789' });
    const file = await api
      .http()
      .get(`/v2/public/booking-assets/${t.slug}/brand-logo`)
      .set('x-forwarded-for', freshIp());
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.from(file.body).equals(PNG)).toBe(true);
  });
});

describe('white-label: the "Powered by" line', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('bpw');
    await api.type(t.admin);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"remove_branding":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
  });

  it('a plan without remove_branding cannot switch it off, and the page keeps it on', async () => {
    const view = await api.as(t.admin).get(THEME);
    expect(view.body.canRemovePoweredBy).toBe(false);
    const res = await save(t.admin, { showPoweredBy: false });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('showPoweredBy');
    expect((await publicPage(t.slug)).body.theme.showPoweredBy).toBe(true);
  });

  it('a plan with it can, and a later downgrade turns the line back on without anyone saving', async () => {
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"remove_branding":true}}' WHERE org_id = $1`,
      [t.orgId],
    );
    expect((await api.as(t.admin).get(THEME)).body.canRemovePoweredBy).toBe(true);
    const res = await save(t.admin, { showPoweredBy: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await publicPage(t.slug)).body.theme.showPoweredBy).toBe(false);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"remove_branding":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    // the stored choice stays; what a visitor sees follows the plan once the short cache has expired or the theme is next saved
    const cur = (await api.as(t.admin).get(THEME)).body;
    expect(cur.theme.showPoweredBy).toBe(false);
    expect(cur.resolved.showPoweredBy).toBe(true);
  });
});

describe('pictures', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('bpp');
    await api.type(t.admin);
  });

  it('uploads a logo, serves it to anyone with the page address, and caches it for a year', async () => {
    const up = await upload(t.admin, `${THEME}/assets/logo`, PNG, 'logo.png');
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const ref = up.body.theme.logo as { id: string; v: string };
    expect(ref.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ref.v).toMatch(/^[0-9a-f]{24}$/);
    expect(up.body.theme.rowVersion).toBeGreaterThanOrEqual(1);
    const pub = await publicPage(t.slug);
    expect(pub.body.theme.logo).toEqual(ref);

    const file = await api
      .http()
      .get(`/v2/public/booking-assets/${t.slug}/${ref.id}`)
      .set('x-forwarded-for', freshIp());
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['cache-control']).toContain('immutable');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-security-policy']).toContain("default-src 'none'");
    expect(file.headers.etag).toBe(`"${ref.v}"`);
    expect(Buffer.from(file.body).equals(PNG)).toBe(true);

    const same = await api
      .http()
      .get(`/v2/public/booking-assets/${t.slug}/${ref.id}`)
      .set('x-forwarded-for', freshIp())
      .set('if-none-match', `"${ref.v}"`);
    expect(same.status).toBe(304);
  });

  it('replacing keeps the address and changes the version; removing makes the page forget it', async () => {
    const before = (await api.as(t.admin).get(THEME)).body.theme.logo as { id: string; v: string };
    const other = Buffer.concat([PNG, Buffer.from([0])]);
    const up = await upload(t.admin, `${THEME}/assets/logo`, other, 'logo2.png');
    expect(up.status).toBe(200);
    expect(up.body.theme.logo.id).toBe(before.id);
    expect(up.body.theme.logo.v).not.toBe(before.v);
    const del = await api.as(t.admin).delete(`${THEME}/assets/logo`);
    expect(del.status).toBe(200);
    expect(del.body.theme.logo).toBeNull();
    expect((await publicPage(t.slug)).body.theme.logo).toBeNull();
    const gone = await api
      .http()
      .get(`/v2/public/booking-assets/${t.slug}/${before.id}`)
      .set('x-forwarded-for', freshIp());
    expect(gone.status).toBe(404);
  });

  it('refuses SVG, a file whose bytes are not the type its name claims, an empty file, and an oversized one', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    for (const [buf, name] of [
      [svg, 'logo.svg'],
      [Buffer.from('<?php echo 1;'), 'logo.png'],
      [Buffer.from('GIF89a-not-really'), 'logo.png'],
      [Buffer.alloc(0), 'logo.png'],
      [Buffer.from('hello'), 'logo.txt'],
    ] as const) {
      const res = await upload(t.admin, `${THEME}/assets/logo`, buf as Buffer, name);
      expect(res.status, name).toBe(422);
      expect(res.body.code, name).toBe('AUTH_UPLOAD_REJECTED');
    }
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10)]);
    const tooBig = await upload(t.admin, `${THEME}/assets/logo`, big, 'big.png');
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.code).toBe('AUTH_UPLOAD_REJECTED');
    // a cover may be larger than a logo
    const cover = await upload(
      t.admin,
      `${THEME}/assets/cover`,
      Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10)]),
      'cover.png',
    );
    expect(cover.status, JSON.stringify(cover.body)).toBe(200);
    expect((await api.as(t.admin).delete(`${THEME}/assets/cover`)).status).toBe(200);
  });

  it('only a picture id is served: anything else, and a picture of another workspace, is 404', async () => {
    const other = await api.signup('bpp2');
    await api.type(other.admin);
    const up = await upload(t.admin, `${THEME}/assets/logo`, PNG, 'logo.png');
    const id = up.body.theme.logo.id as string;
    for (const bad of ['logo', '..', '1', 'not-a-uuid', id.toUpperCase().replace(/-/g, '_')]) {
      const res = await api
        .http()
        .get(`/v2/public/booking-assets/${t.slug}/${bad}`)
        .set('x-forwarded-for', freshIp());
      expect(res.status, bad).toBe(404);
    }
    const cross = await api
      .http()
      .get(`/v2/public/booking-assets/${other.slug}/${id}`)
      .set('x-forwarded-for', freshIp());
    expect(cross.status).toBe(404);
    const unknownOrg = await api
      .http()
      .get(`/v2/public/booking-assets/no-such-workspace/${id}`)
      .set('x-forwarded-for', freshIp());
    expect(unknownOrg.status).toBe(404);
  });
});

describe('access', () => {
  let t: Tenant;
  let other: Tenant;
  let type: BookingType;
  beforeAll(async () => {
    t = await api.signup('bpa');
    other = await api.signup('bpa2');
    type = await api.type(t.admin);
  });

  it('a viewer reads the theme but cannot change it; no token is 401', async () => {
    const viewer = await api.member(t, 'bpviewer', [['record.booking-types.read']]);
    expect((await api.as(viewer.token).get(THEME)).status).toBe(200);
    expect((await api.as(viewer.token).get(`/v2/booking-types/${type.id}/page-theme`)).status).toBe(
      200,
    );
    expect((await save(viewer.token, {})).status).toBe(403);
    expect((await upload(viewer.token, `${THEME}/assets/logo`, PNG, 'l.png')).status).toBe(403);
    expect((await api.as(viewer.token).delete(`${THEME}/assets/logo`)).status).toBe(403);
    expect(
      (await api.as(viewer.token).delete(`/v2/booking-types/${type.id}/page-theme`)).status,
    ).toBe(403);
    expect((await api.http().get(THEME)).status).toBe(401);
    expect((await api.http().put(THEME).send({})).status).toBe(401);
  });

  it('a member with only the update key can change it (the same keys as the rest of the booking set-up)', async () => {
    const editor = await api.member(t, 'bpeditor', [
      ['record.booking-types.read'],
      ['record.booking-types.update'],
    ]);
    expect((await save(editor.token, { welcomeText: 'From an editor' })).status).toBe(200);
  });

  it('another workspace cannot read or change this one, or reach its services', async () => {
    const res = await api.as(other.admin).get(`/v2/booking-types/${type.id}/page-theme`);
    expect(res.status).toBe(404);
    const put = await api
      .as(other.admin)
      .put(`/v2/booking-types/${type.id}/page-theme`)
      .send({
        primaryColor: '#000000',
        accentColor: null,
        backgroundStyle: null,
        welcomeText: null,
        buttonLabel: null,
        rowVersion: null,
      });
    expect(put.status).toBe(404);
    // their own workspace theme is theirs alone
    expect((await save(other.admin, { primaryColor: '#abcdef' })).status).toBe(200);
    expect((await api.as(t.admin).get(THEME)).body.theme.primaryColor).not.toBe('#abcdef');
    const rows = await h.owner.query(
      `SELECT org_id FROM booking_page_themes WHERE booking_type_id IS NULL ORDER BY org_id`,
    );
    expect(new Set(rows.rows.map((r) => Number(r.org_id))).size).toBe(rows.rows.length);
  });

  it('the public answers carry no private workspace data', async () => {
    await save(t.admin, { welcomeText: 'Hello' });
    const pages = [await publicPage(t.slug), await publicType(t.slug, type.slug)];
    for (const res of pages) {
      expect(res.status).toBe(200);
      const json = JSON.stringify(res.body);
      expect(json).not.toContain('@example.test');
      expect(json).not.toMatch(/org_id|orgId|"id":\s*\d/);
      expect(Object.keys(res.body.theme).sort()).toEqual(
        [
          'accentColor',
          'backgroundColor',
          'backgroundStyle',
          'buttonLabel',
          'colorMode',
          'cornerStyle',
          'cover',
          'font',
          'logo',
          'pageTitle',
          'primaryColor',
          'showLanguageSwitch',
          'showPoweredBy',
          'welcomeText',
        ].sort(),
      );
    }
  });

  it('deleting a service takes its override and pictures with it', async () => {
    const doomed = await api.type(t.admin, { name: 'Doomed' });
    await api
      .as(t.admin)
      .put(`/v2/booking-types/${doomed.id}/page-theme`)
      .send({
        primaryColor: '#101010',
        accentColor: null,
        backgroundStyle: null,
        welcomeText: null,
        buttonLabel: null,
        rowVersion: null,
      })
      .expect(200);
    await upload(t.admin, `/v2/booking-types/${doomed.id}/page-theme/assets/cover`, PNG, 'c.png');
    expect((await api.as(t.admin).delete(`/v2/booking-types/${doomed.id}`)).status).toBe(204);
    const left = await h.owner.query(
      `SELECT (SELECT count(*) FROM booking_page_themes WHERE org_id = $1 AND booking_type_id IS NOT NULL)::int AS themes,
              (SELECT count(*) FROM booking_page_assets WHERE org_id = $1)::int AS assets`,
      [t.orgId],
    );
    expect(left.rows[0]).toEqual({ themes: 0, assets: 0 });
  });
});

void bearer;
