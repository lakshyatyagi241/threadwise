import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** The data the compose page opens with (WD-BCAST-004 to 006), against a real Postgres. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const get = (t: Tenant) => api.http().get('/v2/broadcasts/compose').set(bearer(t.admin));

let n = 0;
async function template(
  t: Tenant,
  o: {
    name: string;
    status?: string;
    meta?: boolean;
    metaStatus?: string;
    pausedUntil?: string;
    metaCategory?: string;
    category?: string;
    providerConfigId?: number;
    sid?: string;
  },
) {
  await h.owner.query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, header, footer, category, meta_category, status, meta_template_id, meta_status, paused_until, provider_config_id, twilio_content_sid)
     VALUES ($1,$2,'Hi {{1}}','Sale','Reply STOP',$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      t.orgId,
      o.name,
      o.category ?? 'utility',
      o.metaCategory ?? null,
      o.status ?? 'approved',
      o.meta ? `meta-${t.orgId}-${n++}` : null,
      o.metaStatus ?? null,
      o.pausedUntil ?? null,
      o.providerConfigId ?? null,
      o.sid ?? null,
    ],
  );
}

const config = async (t: Tenant, provider: string, status: string, label: string) =>
  (
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label) VALUES ($1,$2,$3,'+9190000' || $4::text,$5) RETURNING id, uuid`,
      [t.orgId, provider, status, String(n++).padStart(5, '0'), label],
    )
  ).rows[0] as { id: string; uuid: string };

const device = async (t: Tenant, name: string, status = 'connected', active = true) =>
  (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, country_code, status, active) VALUES ($1,$2,$3,'91',$4,$5) RETURNING uuid`,
      [t.orgId, name, `98${String(n++).padStart(8, '0')}`, status, active],
    )
  ).rows[0].uuid as string;

describe('WD-BCAST-004..006: compose data', () => {
  it('a non-Meta workspace lists locally approved and public templates, newest first, with category and media fields', async () => {
    const t = await api.signup('c1');
    await template(t, { name: 'old', status: 'approved' });
    await template(t, { name: 'pending', status: 'pending' });
    await template(t, { name: 'rejected', status: 'rejected' });
    await template(t, { name: 'public', status: 'public', metaCategory: 'MARKETING' });
    const res = await get(t);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.templates.map((x: { name: string }) => x.name)).toEqual(['public', 'old']);
    expect(res.body.templates[0]).toMatchObject({
      category: 'marketing',
      header: 'Sale',
      footer: 'Reply STOP',
      body: 'Hi {{1}}',
      twilioReady: false,
    });
    expect(res.body.templates[1].category).toBe('utility');
  });

  it('a Meta workspace lists only templates Meta approved and not paused', async () => {
    const t = await api.signup('c2');
    await h.owner.query(
      `INSERT INTO workspace_settings (org_id, default_engine) VALUES ($1,'waba')`,
      [t.orgId],
    );
    await template(t, { name: 'ok', meta: true, metaStatus: 'APPROVED' });
    await template(t, { name: 'ghost', meta: false, metaStatus: 'APPROVED' });
    await template(t, { name: 'rejected', meta: true, metaStatus: 'REJECTED' });
    await template(t, {
      name: 'paused',
      meta: true,
      metaStatus: 'APPROVED',
      pausedUntil: '2099-01-01T00:00:00Z',
    });
    await template(t, {
      name: 'was-paused',
      meta: true,
      metaStatus: 'APPROVED',
      pausedUntil: '2020-01-01T00:00:00Z',
    });
    const names = (await get(t)).body.templates.map((x: { name: string }) => x.name).sort();
    expect(names).toEqual(['ok', 'was-paused']);
  });

  it('a template on a disconnected WABA number is hidden; one on a connected number carries its label', async () => {
    const t = await api.signup('c3');
    const live = await config(t, 'waba', 'connected', 'Main');
    const dead = await config(t, 'waba', 'disconnected', 'Old');
    await template(t, { name: 'on-live', providerConfigId: Number(live.id) });
    await template(t, { name: 'on-dead', providerConfigId: Number(dead.id) });
    await template(t, { name: 'unbound' });
    const res = await get(t);
    expect(res.body.templates.map((x: { name: string }) => x.name).sort()).toEqual([
      'on-live',
      'unbound',
    ]);
    expect(res.body.templates.find((x: { name: string }) => x.name === 'on-live').senderLabel).toBe(
      'Main',
    );
  });

  it('senders are the connected numbers, default engine first, sms and disconnected left out', async () => {
    const t = await api.signup('c4');
    await h.owner.query(
      `INSERT INTO workspace_settings (org_id, default_engine) VALUES ($1,'waba')`,
      [t.orgId],
    );
    const d1 = await device(t, 'Shop phone');
    await device(t, 'Gone', 'disconnected');
    await device(t, 'Inactive', 'connected', false);
    const w = await config(t, 'waba', 'connected', 'Cloud');
    await config(t, 'sms', 'connected', 'Texts');
    const tw = await config(t, 'twilio', 'connected', 'Tw');
    await config(t, 'waba', 'pending', 'Pending');
    const res = await get(t);
    expect(res.body.senders.map((s: { key: string }) => s.key)).toEqual([
      `waba:${w.uuid}`,
      `baileys:${d1}`,
      `twilio:${tw.uuid}`,
    ]);
    expect(res.body.senders[0]).toMatchObject({
      engine: 'waba',
      engineLabel: 'Meta',
      label: 'Cloud',
      isDefault: true,
    });
    expect(res.body.senders[1]).toMatchObject({ engineLabel: 'Unofficial API', isDefault: false });
    expect(res.body.senders[1].phone).toMatch(/^\+91/);
    expect(res.body.twilioEnabled).toBe(true);
  });

  it('a tenant sees only its own templates and numbers', async () => {
    const a = await api.signup('c5');
    const b = await api.signup('c6');
    await template(a, { name: 'mine' });
    await device(a, 'A phone');
    const res = await get(b);
    expect(res.body.templates).toEqual([]);
    expect(res.body.senders).toEqual([]);
    expect(res.body.twilioEnabled).toBe(false);
  });

  it('needs the create permission and a sign-in', async () => {
    const t = await api.signup('c7');
    const viewer = await api.member(t, 'viewer', []);
    expect((await api.http().get('/v2/broadcasts/compose').set(bearer(viewer.token))).status).toBe(
      403,
    );
    expect((await api.http().get('/v2/broadcasts/compose')).status).toBe(401);
  });
});
