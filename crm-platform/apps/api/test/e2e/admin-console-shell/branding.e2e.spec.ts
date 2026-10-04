import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Settings Branding (WD-ASHELL-036) and its white-label read by the shell (WD-ASHELL-025), end to end. */
let h: Harness;
let api: Api;
let t: Tenant;
let member: { token: string };
let other: Tenant;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('shbrand');
  member = await api.member(t, 'plainbrand', []);
  other = await api.signup('shbrand2');
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

const get = (token: string) => api.http().get('/v2/shell/workspace/branding').set(bearer(token));
const post = (token: string) => api.http().post('/v2/shell/workspace/branding').set(bearer(token));
const config = (token: string) => api.http().get('/v2/shell/config').set(bearer(token));

describe('Branding tab', () => {
  it('starts empty, shows the limits, and the shell sees no brand', async () => {
    const res = await get(member.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      primary: null,
      accent: null,
      background: null,
      logoUrl: null,
      faviconUrl: null,
      isOwner: false,
      logoMaxBytes: 2 * 1024 * 1024,
      faviconMaxBytes: 512 * 1024,
    });
    expect((await config(t.admin)).body.brand).toBeNull();
  });

  it('the owner saves colours and a logo; the shell applies them for every member', async () => {
    const res = await post(t.admin)
      .field('primary', '#5B3D8A')
      .field('accent', '#00AA88')
      .attach('logo', PNG, 'logo.png');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      primary: '#5b3d8a',
      accent: '#00aa88',
      background: null,
      isOwner: true,
    });
    expect(res.body.logoUrl).toMatch(
      /^\/api\/v2\/shell\/workspace\/branding\/logo\?v=[0-9a-f]{16}$/,
    );
    const cfg = await config(member.token);
    expect(cfg.body.brand).toMatchObject({ primary: '#5b3d8a', logoUrl: res.body.logoUrl });
    const file = await api
      .http()
      .get(res.body.logoUrl.replace('/api', ''))
      .set(bearer(member.token));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('an absent colour is untouched and a blank one clears it (WaDesk)', async () => {
    const keep = await post(t.admin).field('background', '#101010');
    expect(keep.body).toMatchObject({ primary: '#5b3d8a', background: '#101010' });
    const clear = await post(t.admin).field('primary', '');
    expect(clear.body).toMatchObject({ primary: null, accent: '#00aa88' });
  });

  it('a colour that is not #RRGGBB fails validation and nothing changes', async () => {
    const res = await post(t.admin).field('primary', 'red');
    expect(res.status).toBe(422);
    expect((await get(t.admin)).body.accent).toBe('#00aa88');
  });

  it('a member is refused with 403', async () => {
    const res = await post(member.token).field('primary', '#112233');
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('Only the workspace owner can edit these.');
  });

  it('refuses SVG and non-images, and accepts a favicon', async () => {
    const svg = await post(t.admin).attach(
      'logo',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'x.svg',
    );
    expect(svg.status).toBe(422);
    const fake = await post(t.admin).attach('favicon', Buffer.from('not an image'), 'fav.png');
    expect(fake.status).toBe(422);
    const ok = await post(t.admin).attach('favicon', PNG, 'fav.png');
    expect(ok.status).toBe(201);
    expect(ok.body.faviconUrl).toMatch(/branding\/favicon\?v=/);
  });

  it('replacing a file overwrites the row (one row per slot), is audited, and never leaks to another workspace', async () => {
    await post(t.admin).attach('logo', PNG, 'again.png');
    const rows = await h.owner.query(
      `SELECT slot FROM workspace_brand_assets WHERE org_id = $1 ORDER BY slot`,
      [t.orgId],
    );
    expect(rows.rows.map((r: { slot: string }) => r.slot)).toEqual(['favicon', 'logo']);
    const n = await h.owner.query(
      `SELECT count(*) n FROM security_events WHERE subject_org_id = $1 AND event = 'workspace.branding_updated'`,
      [t.orgId],
    );
    expect(Number(n.rows[0].n)).toBeGreaterThanOrEqual(4);
    expect((await get(other.admin)).body).toMatchObject({ logoUrl: null, faviconUrl: null });
    expect((await config(other.admin)).body.brand).toBeNull();
  });
});

describe('Data residency (WD-ASHELL-045)', () => {
  const res = (token: string) =>
    api.http().get('/v2/shell/workspace/data-residency').set(bearer(token));
  const put = (token: string, body: Record<string, unknown>) =>
    api.http().put('/v2/shell/workspace/data-residency').set(bearer(token)).send(body);

  it('starts at no restriction and tells a member they cannot change it', async () => {
    expect((await res(t.admin)).body).toEqual({ residency: 'any', isOwner: true });
    expect((await res(member.token)).body).toEqual({ residency: 'any', isOwner: false });
  });

  it('the owner picks EU only; the translation domain reads the same column; the change is audited', async () => {
    const saved = await put(t.admin, { residency: 'eu_only' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.residency).toBe('eu_only');
    const i18n = await api.http().get('/v2/workspace/translation-settings').set(bearer(t.admin));
    expect(i18n.body.residency).toBe('eu_only');
    const n = await h.owner.query(
      `SELECT count(*) n FROM security_events WHERE subject_org_id = $1 AND event = 'workspace.data_residency_changed'`,
      [t.orgId],
    );
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it('an invalid mode is a 422 and a member gets 403; nothing changes', async () => {
    expect((await put(t.admin, { residency: 'mars' })).status).toBe(422);
    expect((await put(member.token, { residency: 'local' })).status).toBe(403);
    expect((await res(t.admin)).body.residency).toBe('eu_only');
  });

  it('is per workspace', async () => {
    expect((await res(other.admin)).body.residency).toBe('any');
  });
});
