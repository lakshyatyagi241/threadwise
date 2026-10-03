import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  announcementsResponseSchema,
  quickAccessResponseSchema,
  shellConfigResponseSchema,
} from '@crm/contracts';
import { PlatformSettingsService } from '../../../src/modules/auth';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * The customer shell's server side (WD-ASHELL-011, 012, 022, 023, 026) against a real database: mode and rail colours from the
 * platform settings, the menu layout, the one-time tour flag, announcement bars and the person's quick access.
 */
let h: Harness;
let api: Api;
let t: Tenant;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('shuser');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const get = (path: string, token = t.admin) =>
  api.http().get(`/v2/shell/${path}`).set(bearer(token));
const settings = () => h.app.get(PlatformSettingsService);
const setBranding = (doc: Record<string, unknown>) => settings().set('set.branding', doc, 1);

describe('shell config (WD-ASHELL-011, 012)', () => {
  it('needs a signed-in person', async () => {
    expect((await api.http().get('/v2/shell/config')).status).toBe(401);
  });

  it('starts in topbar mode with no rail colours and the default top bar', async () => {
    const res = await get('config');
    expect(res.status).toBe(200);
    const body = shellConfigResponseSchema.parse(res.body);
    expect(body.mode).toBe('topbar');
    expect(body.rail).toEqual({ color: null, textColor: null, accentColor: null });
    expect(body.bar.at(-1)).toBe('more');
    expect(body.more).not.toContain('dashboard');
  });

  it('serves sidebar mode and the rail colours the admin saved', async () => {
    await setBranding({
      dashboardLayout: 'sidebar',
      sidebarColor: '#FFFFFF',
      sidebarTextColor: '',
      sidebarAccentColor: '#5B3D8A',
    });
    const body = shellConfigResponseSchema.parse((await get('config')).body);
    expect(body.mode).toBe('sidebar');
    expect(body.rail).toEqual({ color: '#FFFFFF', textColor: null, accentColor: '#5B3D8A' });
  });

  it('reads an unknown stored mode (grid) as topbar', async () => {
    await setBranding({ dashboardLayout: 'grid' });
    expect(shellConfigResponseSchema.parse((await get('config')).body).mode).toBe('topbar');
  });

  it('follows the menu layout the operators saved', async () => {
    await settings().set('shell.nav_layout', { bar: ['contacts', 'dashboard'] }, 1);
    const body = shellConfigResponseSchema.parse((await get('config')).body);
    expect(body.bar).toEqual(['contacts', 'dashboard', 'more']);
    expect(body.more).not.toContain('contacts');
  });
});

describe('guided tour flag (WD-ASHELL-023)', () => {
  it('runs for a new person, and never again once seen; each person has their own flag', async () => {
    const other = await api.member(t, 'plain', []);
    expect(shellConfigResponseSchema.parse((await get('config')).body).tour.run).toBe(true);
    const seen = await api.http().post('/v2/shell/tour/seen').set(bearer(t.admin));
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual({ ok: true });
    expect(shellConfigResponseSchema.parse((await get('config')).body).tour.run).toBe(false);
    // Marking it again changes nothing and still answers ok.
    expect((await api.http().post('/v2/shell/tour/seen').set(bearer(t.admin))).status).toBe(200);
    expect(shellConfigResponseSchema.parse((await get('config', other.token)).body).tour.run).toBe(
      true,
    );
  });
});

describe('announcement bars (WD-ASHELL-026)', () => {
  const insert = (text: string, tone: string) =>
    h.owner.query(
      `INSERT INTO announcements (text, tone, is_active, sort_order) VALUES ($1, $2, true, 0)`,
      [text, tone],
    );

  it('groups the active ones into one bar per tone, newest-scope rules applied', async () => {
    await h.owner.query(`DELETE FROM announcements`);
    await insert('First info', 'info');
    await insert('Second info', 'info');
    await insert('Be careful', 'warning');
    await h.owner.query(
      `INSERT INTO announcements (text, tone, is_active) VALUES ('Switched off', 'info', false)`,
    );
    await h.owner.query(
      `INSERT INTO announcements (text, tone, is_active, starts_at) VALUES ('Not yet', 'info', true, now() + interval '1 day')`,
    );
    await h.owner.query(
      `INSERT INTO announcements (text, tone, is_active, expires_at) VALUES ('Expired', 'info', true, now() - interval '1 day')`,
    );
    const res = await get('announcements');
    expect(res.status).toBe(200);
    const { bars } = announcementsResponseSchema.parse(res.body);
    expect(bars.map((b) => b.tone)).toEqual(['info', 'warning']);
    expect(bars[0]!.items.map((i) => i.text)).toEqual(['First info', 'Second info']);
    expect(bars[0]!.token.split('-').length).toBeGreaterThan(5);
  });

  it('a new announcement of the same tone changes the dismissal token', async () => {
    const before = announcementsResponseSchema.parse((await get('announcements')).body).bars[0]!
      .token;
    await insert('Third info', 'info');
    const after = announcementsResponseSchema.parse((await get('announcements')).body).bars[0]!
      .token;
    expect(after).not.toBe(before);
    await h.owner.query(`DELETE FROM announcements`);
    expect(announcementsResponseSchema.parse((await get('announcements')).body).bars).toEqual([]);
  });
});

describe('quick access (WD-ASHELL-022)', () => {
  const put = (items: unknown, token = t.admin) =>
    api.http().put('/v2/shell/quick-access').set(bearer(token)).send({ items });

  it('a new person sees the ten defaults', async () => {
    const res = await get('quick-access');
    const { tiles } = quickAccessResponseSchema.parse(res.body);
    expect(tiles).toHaveLength(10);
    expect(tiles[0]!.key).toBe('inbox');
    expect(tiles.every((x) => !x.custom)).toBe(true);
  });

  it('pins Webhooks and a custom link, and the custom one is marked custom', async () => {
    const res = await put([{ key: 'webhooks' }, { label: 'KB', url: 'https://example.com/kb' }]);
    expect(res.status).toBe(200);
    const { tiles } = quickAccessResponseSchema.parse(res.body);
    expect(tiles.map((x) => [x.label, x.custom])).toEqual([
      ['Webhooks', false],
      ['KB', true],
    ]);
    expect(quickAccessResponseSchema.parse((await get('quick-access')).body).tiles).toHaveLength(2);
  });

  it('drops a javascript: link and a protocol-relative link instead of storing them', async () => {
    const res = await put([
      { label: 'x', url: 'javascript:alert(1)' },
      { label: 'evil', url: '//evil.example' },
      { key: 'contacts' },
    ]);
    expect(res.body.tiles).toHaveLength(1);
    const row = await h.owner.query(`SELECT quick_access FROM user_settings WHERE user_id = $1`, [
      t.adminUserId,
    ]);
    expect(row.rows[0].quick_access).toEqual([{ key: 'contacts' }]);
  });

  it('keeps ten at most, and an empty list brings the defaults back (WaDesk)', async () => {
    const many = await put(Array.from({ length: 14 }, () => ({ key: 'inbox' })));
    expect(many.body.tiles).toHaveLength(10);
    const empty = await put([]);
    expect(empty.body.tiles).toHaveLength(10);
    expect(empty.body.tiles[0].key).toBe('inbox');
  });

  it('is private to the person: a colleague still sees the defaults', async () => {
    await put([{ key: 'analytics' }]);
    const other = await api.member(t, 'plain2', []);
    const { tiles } = quickAccessResponseSchema.parse(
      (await get('quick-access', other.token)).body,
    );
    expect(tiles).toHaveLength(10);
  });
});
