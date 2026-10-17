import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  campaignDetailSchema,
  wizardBroadcastDetailSchema,
  wizardLaunchResultSchema,
} from '@crm/contracts';
import {
  bearer,
  buildLab,
  group,
  idOfCampaign,
  makeDraft,
  number,
  payPerMessage,
  people,
  problem,
  readyDraft,
  startHarness,
  wiz,
  world,
  type Lab,
  type World,
} from './broadcast-wizard.support';

/**
 * Sending one broadcast from several numbers (Reference TW-BCAST-006 and TW-BCAST-014, carried into the Campaign wizard): the audience is
 * cut across the picked numbers by their share weights, each contact is written once with its own number, the run sends each from
 * that number, and the 131049 retry goes out from it again. One number behaves exactly as before. WhatsApp is the sandbox sender.
 */
let lab: Lab;

beforeAll(async () => {
  lab = buildLab(await startHarness());
}, 240_000);

afterAll(async () => {
  await lab?.h.stop();
});

const owner = () => lab.h.owner;
let n = 0;

beforeEach(async () => {
  await owner().query(`UPDATE wpcampaigns SET retry_enabled = false WHERE retry_enabled`);
  await owner().query(
    `UPDATE wp_campaign_contacts SET retry_state = 'exhausted' WHERE retry_state IN ('scheduled', 'sending', 'sent')`,
  );
});

/** A workspace whose first number and template belong to Meta account `W-<label>`, plus `extra` more numbers of the same account. */
async function shared(label: string, extra: number) {
  const w = await world(lab, label);
  const account = `W-${label}`;
  await owner().query(
    `UPDATE wa_provider_configs SET meta_json = jsonb_build_object('waba_id', $2::text) WHERE uuid = $1`,
    [w.config, account],
  );
  const configs = [w.config];
  for (let i = 0; i < extra; i++) configs.push(await number2(w, account, `Line ${i + 2}`));
  return { w, configs, account };
}

async function number2(w: World, account: string | null, label: string): Promise<string> {
  const r = await owner().query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, connected_at, meta_json)
     VALUES ($1, 'waba', 'connected', $2, $3, now(), $4::jsonb) RETURNING uuid`,
    [
      w.t.orgId,
      `+1666${String(1_000_000 + n++)}`,
      label,
      account ? JSON.stringify({ waba_id: account }) : null,
    ],
  );
  return r.rows[0].uuid as string;
}

const idOfConfig = async (uuid: string) =>
  Number(
    (await owner().query(`SELECT id FROM wa_provider_configs WHERE uuid = $1`, [uuid])).rows[0].id,
  );

async function contacts(w: World, count: number) {
  const ids = await people(
    lab,
    w.t,
    Array.from({ length: count }, (_, i) => ({ name: `P${String(i).padStart(2, '0')}` })),
  );
  return { ids, g: await group(owner(), w.t, 'G', ids) };
}

const launch = async (w: World, d: { id: string; rowVersion: number }) =>
  wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, { rowVersion: d.rowVersion });

const rowsOf = async (uuid: string) =>
  (
    await owner().query(
      `SELECT c.name, r.status, r.sender_provider, r.sender_device_id, c.phone, c.country_code
       FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
       JOIN wpcampaigns k ON k.org_id = r.org_id AND k.id = r.campaign_id WHERE k.uuid = $1 ORDER BY r.id`,
      [uuid],
    )
  ).rows as Array<{
    name: string;
    status: string;
    sender_provider: string | null;
    sender_device_id: string | null;
    phone: string;
    country_code: string | null;
  }>;

const digits = (s: string) => s.replace(/\D/g, '');

describe('a send split across several numbers', () => {
  it('3 numbers, weights 2/1/1 over 8 contacts: 4/2/2, each contact once, each sent from its own number', async () => {
    const { w, configs } = await shared('bsh1', 2);
    await payPerMessage(lab, w.t, 5_000_000);
    const { g } = await contacts(w, 8);
    const keys = configs.map((c) => `waba:${c}`);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        senderKey: keys[0],
        senderKeys: keys,
        senderShare: { [keys[0]!]: 2, [keys[1]!]: 1, [keys[2]!]: 1 },
      }),
    );
    const res = await launch(w, d);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(wizardLaunchResultSchema.parse(res.body)).toMatchObject({
      recipients: 8,
      status: 'running',
    });

    const ids = await Promise.all(configs.map(idOfConfig));
    const rows = await rowsOf(d.id);
    expect(rows).toHaveLength(8);
    // Sequential slices in contact order: the first four, the next two, the last two.
    expect(rows.map((r) => Number(r.sender_device_id))).toEqual([
      ids[0],
      ids[0],
      ids[0],
      ids[0],
      ids[1],
      ids[1],
      ids[2],
      ids[2],
    ]);
    expect(rows.every((r) => r.sender_provider === 'waba')).toBe(true);
    expect(new Set(rows.map((r) => r.name)).size).toBe(8);

    // The campaign's own number is the first pick, and the launch records the split.
    const camp = (
      await owner().query(
        `SELECT device_id, provider, total_recipients, wizard FROM wpcampaigns WHERE uuid = $1`,
        [d.id],
      )
    ).rows[0];
    expect(Number(camp.device_id)).toBe(ids[0]);
    expect(Number(camp.total_recipients)).toBe(8);
    expect(camp.wizard.launch.split).toEqual([
      { key: keys[0], weight: 2, count: 4 },
      { key: keys[1], weight: 1, count: 2 },
      { key: keys[2], weight: 1, count: 2 },
    ]);

    // The run: every recipient goes out once, from the number its row names.
    const { id, orgId } = await idOfCampaign(owner(), d.id);
    lab.sent.length = 0;
    lab.sentFrom.length = 0;
    expect(await lab.run(orgId, id)).toBe('finished');
    await lab.flush();
    expect(lab.sentFrom).toHaveLength(8);
    expect(new Set(lab.sentFrom.map((x) => x.to)).size).toBe(8);
    const expected = new Map(
      rows.map((r) => [digits(`${r.country_code ?? ''}${r.phone}`), Number(r.sender_device_id)]),
    );
    for (const m of lab.sentFrom) {
      const want = [...expected.entries()].find(([phone]) =>
        phone.endsWith(digits(m.to).slice(-10)),
      );
      expect(want, m.to).toBeDefined();
      expect(m.senderId).toBe(want![1]);
    }
    const after = await rowsOf(d.id);
    expect(after.every((r) => ['sent', 'delivered'].includes(r.status))).toBe(true);
    const status = (
      await owner().query(`SELECT status, total_recipients FROM wpcampaigns WHERE uuid = $1`, [
        d.id,
      ])
    ).rows[0];
    expect(status.status).toBe('completed');
  });

  it('a missing or zero weight counts as 1: two numbers, one with weight 0, split 5/5', async () => {
    const { w, configs } = await shared('bsh2', 1);
    await payPerMessage(lab, w.t, 5_000_000);
    const { g } = await contacts(w, 10);
    const keys = configs.map((c) => `waba:${c}`);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, { senderKey: keys[0], senderKeys: keys, senderShare: { [keys[1]!]: 0 } }),
    );
    expect((await launch(w, d)).status).toBe(200);
    const rows = await rowsOf(d.id);
    const per = new Map<string, number>();
    for (const r of rows) per.set(r.sender_device_id!, (per.get(r.sender_device_id!) ?? 0) + 1);
    expect([...per.values()].sort()).toEqual([5, 5]);
  });

  it('fewer contacts than numbers: some numbers get nobody and the launch still works', async () => {
    const { w, configs } = await shared('bsh3', 2);
    await payPerMessage(lab, w.t, 5_000_000);
    const { g } = await contacts(w, 2);
    const keys = configs.map((c) => `waba:${c}`);
    const d = await makeDraft(lab, w, readyDraft(w, g, { senderKey: keys[0], senderKeys: keys }));
    const res = await launch(w, d);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = await rowsOf(d.id);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.sender_device_id)).size).toBe(2);
  });

  it('a template that belongs to another Meta account is refused on the number it cannot be sent from, and nothing is written', async () => {
    const { w, configs } = await shared('bsh4', 1);
    await payPerMessage(lab, w.t, 5_000_000);
    const foreign = await number2(w, 'W-someone-else', 'Other account');
    const { g } = await contacts(w, 4);
    const keys = [...configs, foreign].map((c) => `waba:${c}`);
    const d = await makeDraft(lab, w, readyDraft(w, g, { senderKey: keys[0], senderKeys: keys }));
    const res = await launch(w, d);
    expect(res.status).toBe(422);
    expect(problem(res).code).toBe('CAMP_TEMPLATE_NOT_ALLOWED');
    expect(problem(res).errors).toEqual([
      { path: 'senderKeys.2', message: 'template_not_on_sender' },
    ]);
    expect(res.body.detail ?? res.body.message ?? '').toMatch(
      /Other account|another WhatsApp Business account/,
    );
    expect(await rowsOf(d.id)).toEqual([]);
    const draft = (await owner().query(`SELECT status FROM wpcampaigns WHERE uuid = $1`, [d.id]))
      .rows[0];
    expect(draft.status).toBe('draft');
    // The same draft launches once the foreign number is taken out.
    const fixed = await wiz(lab, w.t.admin).put(`/drafts/${d.id}`, {
      rowVersion: d.rowVersion,
      senderKeys: keys.slice(0, 2),
    });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect((await launch(w, { id: d.id, rowVersion: fixed.body.rowVersion })).status).toBe(200);
  });

  it('a number that is not connected is a field error on the draft; another engine is accepted', async () => {
    const { w, configs } = await shared('bsh5', 1);
    const { g } = await contacts(w, 2);
    const d = await makeDraft(lab, w, readyDraft(w, g));
    const unknown = await wiz(lab, w.t.admin).put(`/drafts/${d.id}`, {
      rowVersion: d.rowVersion,
      senderKey: `waba:${configs[0]}`,
      senderKeys: [`waba:${configs[0]}`, 'waba:00000000-0000-4000-8000-000000000000'],
    });
    expect(unknown.status).toBe(422);
    expect(problem(unknown).errors[0]?.path).toBe('senderKeys.1');
    const tw = (
      await owner().query(
        `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, connected_at)
         VALUES ($1, 'twilio', 'connected', $2, now()) RETURNING uuid`,
        [w.t.orgId, `+1777${String(1_000_000 + n++)}`],
      )
    ).rows[0].uuid as string;
    // Other engines can share a send now (the Cloud-API-only rule was lifted): a Twilio number is accepted.
    const other = await wiz(lab, w.t.admin).put(`/drafts/${d.id}`, {
      rowVersion: d.rowVersion,
      senderKey: `waba:${configs[0]}`,
      senderKeys: [`waba:${configs[0]}`, `twilio:${tw}`],
    });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
  });

  it("one number is exactly as before: no recipient names a number, the campaign's number sends them all", async () => {
    const { w, configs } = await shared('bsh6', 1);
    await payPerMessage(lab, w.t, 5_000_000);
    const { g } = await contacts(w, 4);
    // Both a plain senderKey and a one-entry senderKeys are the single-number path.
    for (const extra of [{}, { senderKeys: [`waba:${configs[0]}`] }]) {
      const d = await makeDraft(lab, w, readyDraft(w, g, extra));
      expect((await launch(w, d)).status).toBe(200);
      const rows = await rowsOf(d.id);
      expect(rows).toHaveLength(4);
      expect(rows.every((r) => r.sender_provider === null && r.sender_device_id === null)).toBe(
        true,
      );
      const { id, orgId } = await idOfCampaign(owner(), d.id);
      lab.sentFrom.length = 0;
      expect(await lab.run(orgId, id)).toBe('finished');
      expect(lab.sentFrom).toHaveLength(4);
      expect(new Set(lab.sentFrom.map((x) => x.senderId))).toEqual(
        new Set([await idOfConfig(configs[0]!)]),
      );
    }
  });

  it('a number that cannot send fails only its own recipients; the others are delivered', async () => {
    const { w, configs } = await shared('bsh7', 1);
    await payPerMessage(lab, w.t, 5_000_000);
    const { g } = await contacts(w, 6);
    const keys = configs.map((c) => `waba:${c}`);
    const d = await makeDraft(lab, w, readyDraft(w, g, { senderKey: keys[0], senderKeys: keys }));
    expect((await launch(w, d)).status).toBe(200);
    await owner().query(`UPDATE wa_provider_configs SET phone_number = '' WHERE uuid = $1`, [
      configs[1],
    ]);
    const { id, orgId } = await idOfCampaign(owner(), d.id);
    await lab.run(orgId, id);
    await lab.flush();
    const rows = await rowsOf(d.id);
    const second = await idOfConfig(configs[1]!);
    const mine = rows.filter((r) => Number(r.sender_device_id) !== second);
    const theirs = rows.filter((r) => Number(r.sender_device_id) === second);
    expect(mine).toHaveLength(3);
    expect(mine.every((r) => ['sent', 'delivered'].includes(r.status))).toBe(true);
    expect(theirs.every((r) => r.status === 'failed')).toBe(true);
  });

  it('the 131049 retry goes out again from the number the recipient was first sent from', async () => {
    const { w, configs } = await shared('bsh8', 1);
    await payPerMessage(lab, w.t, 5_000_000);
    const phones = [number('1049'), number('1234'), number('2049'), number('1235')];
    const ids = await people(
      lab,
      w.t,
      phones.map((phone, i) => ({ name: `R${i}`, phone })),
    );
    const g = await group(owner(), w.t, 'G', ids);
    const keys = configs.map((c) => `waba:${c}`);
    const endDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        senderKey: keys[0],
        senderKeys: keys,
        retries: { enabled: true, endDate, timezone: 'UTC' },
      }),
    );
    expect((await launch(w, d)).status).toBe(200);
    const { id, orgId } = await idOfCampaign(owner(), d.id);
    lab.clock.now = new Date();
    expect(await lab.run(orgId, id)).toBe('finished');
    await lab.flush();
    await lab.retries.tick();
    const failed = (
      await owner().query(
        `SELECT c.name, r.sender_device_id FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
         WHERE r.campaign_id = $1 AND r.error_code = '131049' ORDER BY c.name`,
        [id],
      )
    ).rows;
    expect(failed.map((x) => x.name)).toEqual(['R0', 'R2']);
    // R0 is in the first slice and R2 in the second: two different numbers.
    expect(new Set(failed.map((x) => x.sender_device_id)).size).toBe(2);

    lab.sentFrom.length = 0;
    lab.clock.now = new Date(Date.now() + 25 * 3_600_000);
    expect((await lab.retries.tick()).sent).toBe(2);
    expect(lab.sentFrom).toHaveLength(2);
    const byPhone = new Map(
      failed.map((x, i) => [
        digits(phones[i === 0 ? 0 : 2]!).slice(-10),
        Number(x.sender_device_id),
      ]),
    );
    for (const m of lab.sentFrom) expect(m.senderId).toBe(byPhone.get(digits(m.to).slice(-10)));
  });
});

const device = async (w: World, name: string) => {
  const r = await owner().query(
    `INSERT INTO devices (org_id, device_name, phone_number, country_code, status, active)
     VALUES ($1, $2, $3, '91', 'connected', true) RETURNING id, uuid`,
    [w.t.orgId, name, `98${String(10_000_000 + n++)}`],
  );
  return { id: Number(r.rows[0].id), key: `baileys:${r.rows[0].uuid as string}` };
};

describe('the breakdown per number on the status and detail pages', () => {
  it('a shared send lists recipients, sent, delivered and failed per number, on the wizard status and the campaign detail', async () => {
    const { w, configs } = await shared('bsh9', 2);
    await payPerMessage(lab, w.t, 5_000_000);
    const { g } = await contacts(w, 8);
    const keys = configs.map((c) => `waba:${c}`);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        senderKey: keys[0],
        senderKeys: keys,
        senderShare: { [keys[0]!]: 2, [keys[1]!]: 1, [keys[2]!]: 1 },
      }),
    );
    expect((await launch(w, d)).status).toBe(200);
    const { id, orgId } = await idOfCampaign(owner(), d.id);
    await lab.run(orgId, id);
    await lab.flush();

    const status = await wiz(lab, w.t.admin).get(`/broadcasts/${d.id}`);
    expect(status.status, JSON.stringify(status.body)).toBe(200);
    const lines = wizardBroadcastDetailSchema.parse(status.body).senders;
    expect(lines.map((l) => [l.key, l.recipients])).toEqual([
      [keys[0], 4],
      [keys[1], 2],
      [keys[2], 2],
    ]);
    // The sandbox answers by the last digits of a number, so a few can fail: each number has sent something, and delivery never passes sent.
    expect(lines.map((l) => l.recipients)).toEqual([4, 2, 2]);
    for (const l of lines) {
      expect(l.sent).toBeGreaterThan(0);
      expect(l.failed).toBeLessThan(l.recipients);
      expect(l.delivered).toBeLessThanOrEqual(l.sent);
    }
    expect(lines[0]!.label).toBe('Main number');

    const detail = await lab.api.http().get(`/v2/campaigns/${d.id}`).set(bearer(w.t.admin));
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(campaignDetailSchema.parse(detail.body).senders.map((l) => l.recipients)).toEqual([
      4, 2, 2,
    ]);
  });

  it('a send from one number has no breakdown', async () => {
    const { w } = await shared('bsh10', 0);
    await payPerMessage(lab, w.t, 5_000_000);
    const { g } = await contacts(w, 3);
    const d = await makeDraft(lab, w, readyDraft(w, g));
    expect((await launch(w, d)).status).toBe(200);
    const status = await wiz(lab, w.t.admin).get(`/broadcasts/${d.id}`);
    expect(wizardBroadcastDetailSchema.parse(status.body).senders).toEqual([]);
    const detail = await lab.api.http().get(`/v2/campaigns/${d.id}`).set(bearer(w.t.admin));
    expect(campaignDetailSchema.parse(detail.body).senders).toEqual([]);
  });
});

describe('a split send over a Cloud API number and personal (device) numbers', () => {
  it('shares 2/1/1 over 8 contacts: 4/2/2, and each recipient is sent from the number on its row, whatever the engine', async () => {
    const { w, configs } = await shared('bsh11', 0);
    await payPerMessage(lab, w.t, 5_000_000);
    const d1 = await device(w, 'Shop phone 1');
    const d2 = await device(w, 'Shop phone 2');
    const { g } = await contacts(w, 8);
    const keys = [`waba:${configs[0]}`, d1.key, d2.key];
    const draft = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        senderKey: keys[0],
        senderKeys: keys,
        senderShare: { [keys[0]!]: 2, [keys[1]!]: 1, [keys[2]!]: 1 },
      }),
    );
    const res = await launch(w, draft);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = await rowsOf(draft.id);
    expect(rows.map((r) => `${r.sender_provider}:${r.sender_device_id}`)).toEqual([
      ...Array(4).fill(`waba:${await idOfConfig(configs[0]!)}`),
      ...Array(2).fill(`baileys:${d1.id}`),
      ...Array(2).fill(`baileys:${d2.id}`),
    ]);
    const { id, orgId } = await idOfCampaign(owner(), draft.id);
    lab.sentFrom.length = 0;
    expect(await lab.run(orgId, id)).toBe('finished');
    await lab.flush();
    const per = new Map<string, number>();
    for (const m of lab.sentFrom)
      per.set(`${m.engine}:${m.senderId}`, (per.get(`${m.engine}:${m.senderId}`) ?? 0) + 1);
    expect(Object.fromEntries(per)).toEqual({
      [`waba:${await idOfConfig(configs[0]!)}`]: 4,
      [`baileys:${d1.id}`]: 2,
      [`baileys:${d2.id}`]: 2,
    });
    expect(new Set(lab.sentFrom.map((m) => m.to)).size).toBe(8);
  });

  it('the template-account gate holds only Cloud API numbers: a device never trips it', async () => {
    const { w, configs } = await shared('bsh12', 0);
    await payPerMessage(lab, w.t, 5_000_000);
    const dev = await device(w, 'Shop phone');
    const { g } = await contacts(w, 2);
    const keys = [`waba:${configs[0]}`, dev.key];
    const d = await makeDraft(lab, w, readyDraft(w, g, { senderKey: keys[0], senderKeys: keys }));
    expect((await launch(w, d)).status).toBe(200);
  });

  it('a mailbox is refused as a sharing number', async () => {
    const { w, configs } = await shared('bsh13', 0);
    const { g } = await contacts(w, 2);
    const mb = await owner().query(
      `INSERT INTO mail_mailboxes (org_id, address, display_name, status) VALUES ($1, $2, 'Shop', 'connected') RETURNING uuid`,
      [w.t.orgId, `shop${n++}@example.com`],
    );
    const d = await makeDraft(lab, w, readyDraft(w, g));
    const res = await wiz(lab, w.t.admin).put(`/drafts/${d.id}`, {
      rowVersion: d.rowVersion,
      senderKey: `waba:${configs[0]}`,
      senderKeys: [`waba:${configs[0]}`, `email:${mb.rows[0].uuid}`],
    });
    expect(res.status).toBe(422);
    expect(problem(res).errors[0]?.path).toBe('senderKeys.1');
  });
});

describe('the classic campaign builder shares a send too', () => {
  const classic = (w: World, over: object) =>
    lab.api
      .http()
      .post('/v2/campaigns')
      .set(bearer(w.t.admin))
      .set('idempotency-key', randomUUID())
      .send({
        name: 'Classic',
        type: 'template',
        templateId: w.template,
        scheduleType: 'now',
        ...over,
      });

  it('3 numbers, shares 2/1/1 over 8 contacts: 4/2/2, each contact once and sent from its own number', async () => {
    const { w, configs } = await shared('bsh14', 2);
    await payPerMessage(lab, w.t, 5_000_000);
    const { ids } = await contacts(w, 8);
    const keys = configs.map((c) => `waba:${c}`);
    const res = await classic(w, {
      senderKey: keys[0],
      senderKeys: keys,
      senderShare: { [keys[0]!]: 2, [keys[1]!]: 1, [keys[2]!]: 1 },
      contactIds: ids,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const uuid = res.body.campaign.id as string;
    const cfgIds = await Promise.all(configs.map(idOfConfig));
    const rows = await rowsOf(uuid);
    expect(rows.map((r) => Number(r.sender_device_id))).toEqual([
      cfgIds[0],
      cfgIds[0],
      cfgIds[0],
      cfgIds[0],
      cfgIds[1],
      cfgIds[1],
      cfgIds[2],
      cfgIds[2],
    ]);
    const { id, orgId } = await idOfCampaign(owner(), uuid);
    lab.sentFrom.length = 0;
    await lab.run(orgId, id);
    expect(lab.sentFrom).toHaveLength(8);
    expect(new Set(lab.sentFrom.map((m) => m.to)).size).toBe(8);
    const byNumber = new Map<number, number>();
    for (const m of lab.sentFrom) byNumber.set(m.senderId, (byNumber.get(m.senderId) ?? 0) + 1);
    expect([...byNumber.entries()].sort()).toEqual(
      [
        [cfgIds[0], 4],
        [cfgIds[1], 2],
        [cfgIds[2], 2],
      ].sort(),
    );

    // A resend to everyone goes out from the same numbers again: the rows keep the number they were given.
    const again = await lab.api
      .http()
      .post(`/v2/campaigns/${uuid}/resend`)
      .set(bearer(w.t.admin))
      .set('idempotency-key', randomUUID())
      .send({ scope: 'all' });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    lab.sentFrom.length = 0;
    await lab.run(orgId, id);
    const second = new Map<number, number>();
    for (const m of lab.sentFrom) second.set(m.senderId, (second.get(m.senderId) ?? 0) + 1);
    expect([...second.entries()].sort()).toEqual([...byNumber.entries()].sort());

    // The edit form gets the numbers back (the campaign's own first), weighted by what each was given.
    const cfg = await lab.api.http().get(`/v2/campaigns/${uuid}/config`).set(bearer(w.t.admin));
    expect(cfg.body.senderKeys).toEqual(keys);
    expect(cfg.body.senderShare).toEqual({ [keys[0]!]: 4, [keys[1]!]: 2, [keys[2]!]: 2 });
    // And the detail page breaks it down per number.
    const detail = await lab.api.http().get(`/v2/campaigns/${uuid}`).set(bearer(w.t.admin));
    expect(detail.body.senders.map((l: { recipients: number }) => l.recipients)).toEqual([4, 2, 2]);
  });

  it('one number is exactly as before: no recipient names a number', async () => {
    const { w, configs } = await shared('bsh15', 1);
    await payPerMessage(lab, w.t, 5_000_000);
    const { ids } = await contacts(w, 4);
    const res = await classic(w, { senderKey: `waba:${configs[0]}`, contactIds: ids });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await rowsOf(res.body.campaign.id);
    expect(rows.every((r) => r.sender_provider === null)).toBe(true);
  });

  it('a template of another Meta account is refused on the number it cannot go out from; nothing is written', async () => {
    const { w, configs } = await shared('bsh16', 0);
    await payPerMessage(lab, w.t, 5_000_000);
    const foreign = await number2(w, 'W-someone-else', 'Other account');
    const { ids } = await contacts(w, 4);
    const keys = [`waba:${configs[0]}`, `waba:${foreign}`];
    const res = await classic(w, { senderKey: keys[0], senderKeys: keys, contactIds: ids });
    expect(res.status).toBe(422);
    expect(problem(res).code).toBe('CAMP_TEMPLATE_NOT_ALLOWED');
    expect(problem(res).errors).toEqual([
      { path: 'senderKeys.1', message: 'template_not_on_sender' },
    ]);
  });

  it('editing the numbers of a scheduled campaign cuts its recipients again; ', async () => {
    const { w, configs } = await shared('bsh17', 1);
    await payPerMessage(lab, w.t, 5_000_000);
    const { ids } = await contacts(w, 6);
    const keys = configs.map((c) => `waba:${c}`);
    const cfgIds = await Promise.all(configs.map(idOfConfig));
    const created = await classic(w, {
      senderKey: keys[0],
      scheduleType: 'scheduled',
      sendDate: '2099-01-01',
      sendTime: '10:00',
      timezone: 'UTC',
      contactIds: ids,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const uuid = created.body.campaign.id as string;
    expect((await rowsOf(uuid)).every((r) => r.sender_provider === null)).toBe(true);
    const edit = await lab.api
      .http()
      .put(`/v2/campaigns/${uuid}`)
      .set(bearer(w.t.admin))
      .send({
        name: 'Classic',
        type: 'template',
        templateId: w.template,
        scheduleType: 'scheduled',
        sendDate: '2099-01-01',
        sendTime: '10:00',
        timezone: 'UTC',
        senderKey: keys[0],
        senderKeys: keys,
        senderShare: { [keys[0]!]: 1, [keys[1]!]: 1 },
      });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const rows = await rowsOf(uuid);
    expect(rows.map((r) => Number(r.sender_device_id))).toEqual([
      cfgIds[0],
      cfgIds[0],
      cfgIds[0],
      cfgIds[1],
      cfgIds[1],
      cfgIds[1],
    ]);
  });
});
