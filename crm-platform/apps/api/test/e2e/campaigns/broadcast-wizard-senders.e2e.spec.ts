import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignBuilderSchema, wizardSendersResponseSchema } from '@crm/contracts';
import { buildLab, startHarness, wiz, world, type Lab } from './broadcast-wizard.support';
import { bearer } from '../contacts-attributes-tags/support';

/**
 * Why the "Send from" list is empty or short. The platform's unofficial-engine switch is OFF here (its production default), so a
 * workspace with only a personal (QR) number has nothing to send from, and the senders endpoint says why instead of an empty list:
 * `hidden` counts the numbers that exist but are left out, by engine and reason, with no number, label or secret.
 */
let lab: Lab;

beforeAll(async () => {
  lab = buildLab(await startHarness({ unofficialWhatsapp: false }));
}, 240_000);

afterAll(async () => {
  await lab?.h.stop();
});

const owner = () => lab.h.owner;
let n = 0;

const device = (orgId: number, status = 'connected', active = true) =>
  owner().query(
    `INSERT INTO devices (org_id, device_name, phone_number, country_code, status, active) VALUES ($1,'Shop phone',$2,'91',$3,$4)`,
    [orgId, `98${String(n++).padStart(8, '0')}`, status, active],
  );
const config = (orgId: number, provider: string, status: string) =>
  owner().query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label) VALUES ($1,$2,$3,$4,'Line')`,
    [orgId, provider, status, `+1555${String(2_000_000 + n++)}`],
  );

const senders = async (token: string) => {
  const res = await wiz(lab, token).get('/senders');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return wizardSendersResponseSchema.parse(res.body);
};

describe('GET /v2/broadcast-wizard/senders explains what it leaves out', () => {
  it('a workspace with only a personal number gets an empty list and the unofficial_disabled reason', async () => {
    const t = await lab.api.signup('bwsh1');
    await device(t.orgId);
    await device(t.orgId, 'disconnected');
    const res = await senders(t.admin);
    expect(res.data).toEqual([]);
    expect(res.hidden).toEqual([{ engine: 'baileys', reason: 'unofficial_disabled', count: 2 }]);
  });

  it('a pending, a failed and a disconnected Meta number are counted by reason and not listed; a connected one is listed', async () => {
    const w = await world(lab, 'bwsh2');
    await config(w.t.orgId, 'waba', 'pending');
    await config(w.t.orgId, 'waba', 'pending');
    await config(w.t.orgId, 'waba', 'failed');
    await config(w.t.orgId, 'twilio', 'disconnected');
    const res = await senders(w.t.admin);
    expect(res.data.map((s) => s.key)).toEqual([`waba:${w.config}`]);
    expect(res.hidden).toEqual([
      { engine: 'twilio', reason: 'not_connected', count: 1 },
      { engine: 'waba', reason: 'error', count: 1 },
      { engine: 'waba', reason: 'pending', count: 2 },
    ]);
  });

  it('a workspace with no number at all has nothing hidden: the list is empty because nothing is connected', async () => {
    const t = await lab.api.signup('bwsh3');
    const res = await senders(t.admin);
    expect(res).toEqual({ data: [], hidden: [] });
  });

  it('SMS numbers are not part of the WhatsApp list and are not counted in it', async () => {
    const t = await lab.api.signup('bwsh4');
    await config(t.orgId, 'sms', 'connected');
    await config(t.orgId, 'sms', 'pending');
    const res = await senders(t.admin);
    expect(res).toEqual({ data: [], hidden: [] });
  });

  it('the reasons carry no phone number, label or key', async () => {
    const w = await world(lab, 'bwsh5');
    await config(w.t.orgId, 'waba', 'pending');
    await device(w.t.orgId);
    const res = await lab.api.http().get('/v2/broadcast-wizard/senders').set(bearer(w.t.admin));
    for (const h of res.body.hidden)
      expect(Object.keys(h).sort()).toEqual(['count', 'engine', 'reason']);
    expect(JSON.stringify(res.body.hidden)).not.toMatch(/\+?\d{6,}|Line|Shop phone/);
  });

  it("another workspace's numbers are never counted", async () => {
    const a = await lab.api.signup('bwsh6a');
    const b = await lab.api.signup('bwsh6b');
    await device(a.orgId);
    await config(a.orgId, 'waba', 'pending');
    expect(await senders(b.admin)).toEqual({ data: [], hidden: [] });
  });

  it('a role without camp.campaigns.create gets 403, not an empty list', async () => {
    const t = await lab.api.signup('bwsh7');
    const reader = await lab.api.member(t, 'reader', [['camp.campaigns.read']]);
    expect((await wiz(lab, reader.token).get('/senders')).status).toBe(403);
    expect((await lab.api.http().get('/v2/broadcast-wizard/senders')).status).toBe(401);
  });
});

describe('GET /v2/campaigns/builder carries the same hidden reasons', () => {
  it('lists the reasons next to the senders', async () => {
    const w = await world(lab, 'bwsh8');
    await device(w.t.orgId);
    await config(w.t.orgId, 'waba', 'pending');
    const res = await lab.api.http().get('/v2/campaigns/builder').set(bearer(w.t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = campaignBuilderSchema.parse(res.body);
    expect(body.senders.map((s) => s.key)).toEqual([`waba:${w.config}`]);
    expect(body.hidden).toEqual([
      { engine: 'baileys', reason: 'unofficial_disabled', count: 1 },
      { engine: 'waba', reason: 'pending', count: 1 },
    ]);
  });

  it('the SMS scope counts only SMS numbers that are not connected', async () => {
    const t = await lab.api.signup('bwsh9');
    await device(t.orgId);
    await config(t.orgId, 'waba', 'pending');
    await config(t.orgId, 'sms', 'failed');
    const res = await lab.api.http().get('/v2/campaigns/builder?channel=sms').set(bearer(t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // The SMS card is empty while the platform switch `sms_enabled` is off: nothing to explain by number.
    expect(res.body.senders).toEqual([]);
    expect(res.body.hidden).toEqual([]);
  });

  it('the builder needs camp.campaigns.read', async () => {
    const t = await lab.api.signup('bwsh10');
    const nobody = await lab.api.member(t, 'nobody', []);
    expect(
      (await lab.api.http().get('/v2/campaigns/builder').set(bearer(nobody.token))).status,
    ).toBe(403);
  });
});
