import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MESSAGE_DELIVERY_EVENT, walletDeliveryReportedSchema } from '@crm/contracts';
import {
  buildLab,
  group,
  idOfCampaign,
  makeDraft,
  payPerMessage,
  people,
  readyDraft,
  startHarness,
  wiz,
  world,
  type Lab,
  type World,
} from './broadcast-wizard.support';

/**
 * Follow-up steps of a guided campaign, against a real Postgres: a recipient's reaction (or silence) after the campaign message
 * decides whether a second message goes out or a flow starts, up to three steps in a row. WhatsApp is the sandbox sender, the flow
 * runtime is a recording stub, the clock is ours; a reply is a real inbound message in the inbox and a read is the provider's report.
 */
let lab: Lab;

beforeAll(async () => {
  lab = buildLab(await startHarness());
}, 240_000);

afterAll(async () => {
  await lab?.h.stop();
});

const owner = () => lab.h.owner;
let phones = 0;
/** A fresh number the sandbox delivers to (its last four digits decide what happens). */
const delivered = () => `+9199${String(2000 + phones++).padStart(4, '0')}1234`;
const MIN = 60_000;

// The worker's passes scan every tenant and these specs share one database: each test starts with the others' chains parked.
beforeEach(async () => {
  await owner().query(
    `UPDATE wp_campaign_contacts SET follow_up_state = 'done', follow_up_next = NULL, follow_up_base_at = NULL, follow_up_check_at = NULL
     WHERE follow_up_state = 'active'`,
  );
  await owner().query(`UPDATE wpcampaigns SET follow_up_count = 0 WHERE follow_up_count > 0`);
  await owner().query(`UPDATE camp_series SET status = 'cancelled' WHERE status = 'active'`);
});

type Step = {
  trigger: 'replied' | 'read' | 'not_replied' | 'not_read';
  waitMinutes: number;
  action: { kind: 'template'; templateId: string | null } | { kind: 'flow'; flowId: string | null };
};

/** A second approved template on the world's number: what a follow-up sends. */
async function secondTemplate(w: World, body = 'Still thinking, {{1}}? The offer ends soon.') {
  const cfg = (
    await owner().query(`SELECT id FROM wa_provider_configs WHERE org_id = $1 AND uuid = $2`, [
      w.t.orgId,
      w.config,
    ])
  ).rows[0] as { id: number };
  const t = await owner().query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status, language, meta_category, category,
                               provider_config_id, variable_map)
     VALUES ($1, $2, $3, 'standard', 'approved', 'en_US', 'marketing', 'marketing', $4, $5::jsonb) RETURNING uuid, template_name`,
    [
      w.t.orgId,
      `nudge_${Math.random().toString(36).slice(2, 10)}`,
      body,
      cfg.id,
      JSON.stringify({ body: [{ num: 1, key: 'first_name', example: 'Asha' }] }),
    ],
  );
  return { uuid: t.rows[0].uuid as string, name: t.rows[0].template_name as string };
}

async function aFlow(w: World) {
  const f = await owner().query(
    `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, trigger_keywords, is_published, is_active, provider, flow_type)
     VALUES ($1, 'Welcome back', '{}'::jsonb, 'keyword', NULL, true, true, 'waba', 'chat') RETURNING id, uuid`,
    [w.t.orgId],
  );
  return { uuid: f.rows[0].uuid as string, id: Number(f.rows[0].id) };
}

interface Launched {
  w: World;
  orgId: number;
  id: number;
  uuid: string;
  start: Date;
  /** contact name -> row */
  who: Record<string, { contactId: number; recipientId: number; wamid: string }>;
}

/** A campaign with `steps`, sent now to the named people (the sandbox delivers all of them). */
async function launch(
  label: string,
  names: string[],
  steps: (w: World) => Promise<Step[]> | Step[],
): Promise<Launched> {
  const w = await world(lab, label);
  await payPerMessage(lab, w.t, 5_000_000);
  const ids = await people(
    lab,
    w.t,
    names.map((name) => ({ name, phone: delivered() })),
  );
  const g = await group(owner(), w.t, 'G', ids);
  const followUps = await steps(w);
  const d = await makeDraft(lab, w, readyDraft(w, g, { followUps }));
  const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
    rowVersion: d.rowVersion,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const { id, orgId } = await idOfCampaign(owner(), d.id);
  const start = new Date();
  lab.clock.now = start;
  lab.sent.length = 0;
  expect(await lab.run(orgId, id)).toBe('finished');
  await lab.flush();
  const rows = await owner().query(
    `SELECT c.name, r.contact_id, r.id, r.whatsapp_message_id FROM wp_campaign_contacts r
     JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id WHERE r.campaign_id = $1`,
    [id],
  );
  const who = Object.fromEntries(
    rows.rows.map((r) => [
      r.name as string,
      {
        contactId: Number(r.contact_id),
        recipientId: Number(r.id),
        wamid: r.whatsapp_message_id as string,
      },
    ]),
  );
  lab.sent.length = 0;
  return { w, orgId, id, uuid: d.id, start, who };
}

const after = (c: Launched, minutes: number) => {
  lab.clock.now = new Date(c.start.getTime() + minutes * MIN);
};

const chain = async (c: Launched) =>
  Object.fromEntries(
    (
      await owner().query(
        `SELECT c.name, r.follow_up_state, r.follow_up_next FROM wp_campaign_contacts r
         JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id WHERE r.campaign_id = $1`,
        [c.id],
      )
    ).rows.map((r) => [
      r.name as string,
      { state: r.follow_up_state as string | null, next: r.follow_up_next as number | null },
    ]),
  );

const attempts = async (c: Launched) =>
  (
    await owner().query(
      `SELECT c.name, a.step_no, a.outcome, a.trigger, a.action_kind, a.delivery_status, a.provider_message_id, a.error_message
       FROM camp_follow_up_attempts a JOIN wp_campaign_contacts r ON r.org_id = a.org_id AND r.id = a.recipient_id
       JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id WHERE a.campaign_id = $1 ORDER BY c.name, a.step_no`,
      [c.id],
    )
  ).rows.map((r) => ({ ...r, step_no: Number(r.step_no) }));

/**
 * An inbound message from the contact at `at`, in a thread the campaign's contact owns. By default it arrives on the WhatsApp Cloud
 * API number the campaign was sent from (the channel linked to that connection); `'other'` puts it on an Instagram channel instead.
 */
async function reply(
  c: Launched,
  name: string,
  at: Date,
  body: string | null = 'Yes please',
  on: 'sender' | 'other' = 'sender',
) {
  const p = c.who[name]!;
  let ch: { rows: Array<{ id: number }> };
  if (on === 'other') {
    ch = await owner().query(
      `INSERT INTO channels (org_id, kind, name, status) VALUES ($1, 'instagram', 'IG', 'connected') RETURNING id`,
      [c.orgId],
    );
  } else {
    const cfg = (
      await owner().query(`SELECT id FROM wa_provider_configs WHERE org_id = $1 AND uuid = $2`, [
        c.orgId,
        c.w.config,
      ])
    ).rows[0] as { id: number };
    ch = await owner().query(`SELECT id FROM channels WHERE org_id = $1 AND waba_config_id = $2`, [
      c.orgId,
      cfg.id,
    ]);
    if (ch.rows.length === 0)
      ch = await owner().query(
        `INSERT INTO channels (org_id, kind, name, status, waba_config_id) VALUES ($1, 'whatsapp_cloud', 'WA', 'connected', $2) RETURNING id`,
        [c.orgId, cfg.id],
      );
  }
  const cv = await owner().query(
    `INSERT INTO conversations (org_id, channel_id, peer_key, title, contact_id, msg_seq) VALUES ($1,$2,$3,$4,$5,1) RETURNING id`,
    [c.orgId, ch.rows[0].id, `9199${Math.random().toString().slice(2, 10)}`, name, p.contactId],
  );
  await owner().query(
    `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, body, created_at)
     VALUES ($1,$2,1,'in','text','customer','received',$3,$4)`,
    [c.orgId, cv.rows[0].id, body, at],
  );
}

const readReport = (wamid: string, at: Date) =>
  lab.receipts.handle({ providerMessageId: wamid, status: 'read', occurredAt: at });

const recipient = async (id: number) =>
  (
    await owner().query(
      `SELECT status, response, responded_at, follow_up_state FROM wp_campaign_contacts WHERE id = $1`,
      [id],
    )
  ).rows[0];

describe('launching a campaign with follow-ups', () => {
  it('keeps the steps on the draft, stores their count on the campaign, and asks for a template or a flow', async () => {
    const w = await world(lab, 'fu-launch');
    await payPerMessage(lab, w.t, 5_000_000);
    const ids = await people(lab, w.t, [{}]);
    const g = await group(owner(), w.t, 'G', ids);
    const t2 = await secondTemplate(w);

    const incomplete = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        followUps: [
          { trigger: 'not_read', waitMinutes: 60, action: { kind: 'template', templateId: null } },
        ],
      }),
    );
    const refused = await wiz(lab, w.t.admin).post(`/drafts/${incomplete.id}/launch`, {
      rowVersion: incomplete.rowVersion,
    });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('follow_up_template_required');

    const noFlow = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        followUps: [
          {
            trigger: 'replied',
            waitMinutes: 30,
            action: { kind: 'flow', flowId: '00000000-0000-4000-8000-000000000000' },
          },
        ],
      }),
    );
    const noFlowRes = await wiz(lab, w.t.admin).post(`/drafts/${noFlow.id}/launch`, {
      rowVersion: noFlow.rowVersion,
    });
    expect(noFlowRes.status).toBe(422);
    expect(JSON.stringify(noFlowRes.body)).toContain('follow_up_flow_required');

    const flow = await aFlow(w);
    const ok = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        followUps: [
          {
            trigger: 'not_read',
            waitMinutes: 60,
            action: { kind: 'template', templateId: t2.uuid },
          },
          { trigger: 'replied', waitMinutes: 120, action: { kind: 'flow', flowId: flow.uuid } },
        ],
      }),
    );
    const res = await wiz(lab, w.t.admin).post(`/drafts/${ok.id}/launch`, {
      rowVersion: ok.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (
      await owner().query(`SELECT follow_up_count, wizard FROM wpcampaigns WHERE uuid = $1`, [
        ok.id,
      ])
    ).rows[0];
    expect(Number(row.follow_up_count)).toBe(2);
    expect(row.wizard.draft.followUps).toHaveLength(2);
  });

  it('refuses more than three steps', async () => {
    const w = await world(lab, 'fu-max');
    const t2 = await secondTemplate(w);
    const step = {
      trigger: 'not_read',
      waitMinutes: 10,
      action: { kind: 'template', templateId: t2.uuid },
    };
    const res = await wiz(lab, w.t.admin).post('/drafts', { followUps: [step, step, step, step] });
    expect(res.status).toBe(422);
  });
});

describe('"not read" and "not replied": wait, then check', () => {
  it('sends the follow-up once, after the wait, to the recipient who has not read; nothing before', async () => {
    const c = await launch('fu-notread', ['Asha'], async (w) => [
      {
        trigger: 'not_read',
        waitMinutes: 60,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    after(c, 0);
    expect((await lab.followUps.tick()).armed).toBe(1);
    expect(await chain(c)).toEqual({ Asha: { state: 'active', next: 1 } });

    after(c, 59);
    expect((await lab.followUps.tick()).acted).toBe(0);
    expect(lab.sent).toHaveLength(0);

    after(c, 61);
    expect((await lab.followUps.tick()).acted).toBe(1);
    expect(lab.sent).toHaveLength(1);
    expect(lab.sent[0]!.templateName).toMatch(/^nudge_/);

    // Never twice: the recipient is out of the chain and the step is logged once.
    after(c, 200);
    expect((await lab.followUps.tick()).acted).toBe(0);
    expect(lab.sent).toHaveLength(1);
    expect(await attempts(c)).toMatchObject([
      { name: 'Asha', step_no: 1, outcome: 'sent', trigger: 'not_read', action_kind: 'template' },
    ]);
    expect((await chain(c)).Asha).toEqual({ state: 'done', next: null });
  });

  it('a recipient who read before the wait ends is skipped: nothing is sent and the log says so', async () => {
    const c = await launch('fu-readearly', ['Asha', 'Binod'], async (w) => [
      {
        trigger: 'not_read',
        waitMinutes: 60,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    after(c, 0);
    await lab.followUps.tick();
    after(c, 20);
    expect(await readReport(c.who.Asha!.wamid, lab.clock.now)).toBe(true);

    after(c, 61);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(1);
    expect(await attempts(c)).toMatchObject([
      { name: 'Asha', outcome: 'skipped' },
      { name: 'Binod', outcome: 'sent' },
    ]);
  });

  it('"not replied" fires for the silent and skips the one who wrote back', async () => {
    const c = await launch('fu-notreplied', ['Asha', 'Binod'], async (w) => [
      {
        trigger: 'not_replied',
        waitMinutes: 30,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    await reply(c, 'Binod', new Date(c.start.getTime() + 10 * MIN));
    after(c, 31);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(1);
    expect((await attempts(c)).map((a) => [a.name, a.outcome])).toEqual([
      ['Asha', 'sent'],
      ['Binod', 'skipped'],
    ]);
    // The reply Binod wrote is also the campaign's response, so the statistics count it.
    expect(await recipient(c.who.Binod!.recipientId)).toMatchObject({ response: 'Yes please' });
  });
});

describe('BL-177: a follow-up is deferred, not skipped, in the quiet hours', () => {
  /** HH:MM on the clock of India, where the sandbox's +91 numbers are read. */
  const ist = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d);

  it('holds a marketing follow-up that falls inside the quiet hours and sends it when they end', async () => {
    const c = await launch('fu-quiet', ['Asha'], async (w) => [
      {
        trigger: 'not_replied',
        waitMinutes: 60,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    // Quiet from 30 minutes after the campaign went out until three hours after it: the follow-up (at 60 minutes) falls inside.
    const from = new Date(c.start.getTime() + 30 * MIN);
    const until = new Date(c.start.getTime() + 180 * MIN);
    await owner().query(
      `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end) VALUES ($1, true, $2, $3)`,
      [c.orgId, ist(from), ist(until)],
    );

    after(c, 61);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(0);
    // Not skipped and not failed: the step is still waiting, to be looked at again when the hours end.
    expect(await attempts(c)).toEqual([]);
    expect((await chain(c)).Asha).toEqual({ state: 'active', next: 1 });
    const due = (
      await owner().query(`SELECT follow_up_check_at FROM wp_campaign_contacts WHERE id = $1`, [
        c.who.Asha!.recipientId,
      ])
    ).rows[0].follow_up_check_at as Date;
    expect(Math.abs(due.getTime() - until.getTime())).toBeLessThan(60_000);

    after(c, 181);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(1);
    expect((await attempts(c)).map((a) => [a.name, a.outcome])).toEqual([['Asha', 'sent']]);
  });
});

describe('"replied" and "read": watch, fire at once, or run out', () => {
  it('fires on the first look after the reply, well before the watch time ends', async () => {
    const c = await launch('fu-replied', ['Asha', 'Binod'], async (w) => [
      {
        trigger: 'replied',
        waitMinutes: 240,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    after(c, 5);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(0);

    await reply(c, 'Asha', new Date(c.start.getTime() + 8 * MIN));
    after(c, 10);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(1);
    expect((await attempts(c)).map((a) => [a.name, a.outcome])).toEqual([['Asha', 'sent']]);
    // Binod is still being watched.
    expect((await chain(c)).Binod).toEqual({ state: 'active', next: 1 });
  });

  it('lapses when the watch time runs out without a reply: the chain ends, nothing is sent', async () => {
    const c = await launch('fu-lapse', ['Asha'], async (w) => [
      {
        trigger: 'replied',
        waitMinutes: 90,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    after(c, 89);
    await lab.followUps.tick();
    expect(await chain(c)).toEqual({ Asha: { state: 'active', next: 1 } });
    after(c, 91);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(0);
    expect(await attempts(c)).toMatchObject([{ name: 'Asha', outcome: 'lapsed' }]);
    expect((await chain(c)).Asha).toEqual({ state: 'done', next: null });
  });

  it('a message from the contact on another channel (Instagram) is not a reply: the step lapses', async () => {
    const c = await launch('fu-other-channel', ['Asha'], async (w) => [
      {
        trigger: 'replied',
        waitMinutes: 90,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    await reply(c, 'Asha', new Date(c.start.getTime() + 8 * MIN), 'hi on instagram', 'other');
    after(c, 5);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(0);
    after(c, 91);
    await lab.followUps.tick();
    expect(await attempts(c)).toMatchObject([{ name: 'Asha', outcome: 'lapsed' }]);
    expect(lab.sent).toHaveLength(0);
  });

  it('"read" fires when the provider reports the campaign message read', async () => {
    const c = await launch('fu-read', ['Asha'], async (w) => [
      {
        trigger: 'read',
        waitMinutes: 180,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    after(c, 5);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(0);
    after(c, 20);
    await readReport(c.who.Asha!.wamid, lab.clock.now);
    after(c, 21);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(1);
  });
});

describe('what a step does', () => {
  it('starts the flow for the recipient (and sends no message)', async () => {
    let flow: { uuid: string; id: number } | null = null;
    const c = await launch('fu-flow', ['Asha'], async (w) => {
      flow = await aFlow(w);
      return [
        { trigger: 'not_read', waitMinutes: 30, action: { kind: 'flow', flowId: flow.uuid } },
      ];
    });
    lab.flowCalls.length = 0;
    after(c, 31);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(0);
    expect(lab.flowCalls).toEqual([
      { orgId: c.orgId, flowId: flow!.id, contactId: c.who.Asha!.contactId, campaignId: c.id },
    ]);
    expect(await attempts(c)).toMatchObject([{ outcome: 'flow_started', action_kind: 'flow' }]);
  });

  it('a recipient who opted out after the campaign message never gets the follow-up', async () => {
    const c = await launch('fu-optout', ['Asha', 'Binod'], async (w) => [
      {
        trigger: 'not_read',
        waitMinutes: 30,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    await owner().query(`UPDATE contacts SET is_unsubscribed = true WHERE id = $1`, [
      c.who.Asha!.contactId,
    ]);
    after(c, 31);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(1);
    expect((await attempts(c)).map((a) => [a.name, a.outcome])).toEqual([
      ['Asha', 'skipped'],
      ['Binod', 'sent'],
    ]);
  });

  it('a step already claimed by an interrupted look is never sent again: the recipient moves on', async () => {
    const c = await launch('fu-once', ['Asha'], async (w) => [
      {
        trigger: 'not_read',
        waitMinutes: 30,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    after(c, 0);
    await lab.followUps.tick();
    await owner().query(
      `INSERT INTO camp_follow_up_attempts (org_id, campaign_id, recipient_id, step_no, trigger, action_kind, scheduled_for, outcome)
       VALUES ($1,$2,$3,1,'not_read','template', now(), 'claimed')`,
      [c.orgId, c.id, c.who.Asha!.recipientId],
    );
    after(c, 31);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(0);
    expect((await chain(c)).Asha).toEqual({ state: 'done', next: null });
    expect(await attempts(c)).toHaveLength(1);
  });

  it('a campaign without follow-ups never starts a chain', async () => {
    const w = await world(lab, 'fu-none');
    await payPerMessage(lab, w.t, 5_000_000);
    const ids = await people(lab, w.t, [{ phone: delivered() }]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g));
    await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, { rowVersion: d.rowVersion });
    const { id, orgId } = await idOfCampaign(owner(), d.id);
    lab.clock.now = new Date();
    await lab.run(orgId, id);
    expect((await lab.followUps.tick()).armed).toBe(0);
  });
});

describe('a chain of steps', () => {
  it("step 2 is measured from step 1's message and looks at whether THAT message was read", async () => {
    const c = await launch('fu-chain', ['Asha', 'Binod'], async (w) => [
      {
        trigger: 'not_replied',
        waitMinutes: 60,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
      {
        trigger: 'not_read',
        waitMinutes: 30,
        action: {
          kind: 'template',
          templateId: (await secondTemplate(w, 'Last call, {{1}}.')).uuid,
        },
      },
    ]);
    after(c, 61);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(2);
    const stepOne = await attempts(c);
    expect(stepOne.map((a) => [a.name, a.step_no, a.outcome])).toEqual([
      ['Asha', 1, 'sent'],
      ['Binod', 1, 'sent'],
    ]);
    expect(await chain(c)).toEqual({
      Asha: { state: 'active', next: 2 },
      Binod: { state: 'active', next: 2 },
    });

    // Asha reads step 1's message at +80 min; Binod does not.
    const asha1 = stepOne.find((a) => a.name === 'Asha')!.provider_message_id as string;
    after(c, 80);
    expect(await readReport(asha1, lab.clock.now)).toBe(true);

    // Step 2 is due 30 minutes after step 1 went out (+61), so at +92.
    after(c, 85);
    lab.sent.length = 0;
    expect((await lab.followUps.tick()).acted).toBe(0);
    after(c, 92);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(1);
    expect(
      (await attempts(c)).filter((a) => a.step_no === 2).map((a) => [a.name, a.outcome]),
    ).toEqual([
      ['Asha', 'skipped'],
      ['Binod', 'sent'],
    ]);
    expect(await chain(c)).toEqual({
      Asha: { state: 'done', next: null },
      Binod: { state: 'done', next: null },
    });
  });

  it('a step whose watch ran out ends the whole chain: later steps never run', async () => {
    const c = await launch('fu-chain-end', ['Asha'], async (w) => [
      {
        trigger: 'replied',
        waitMinutes: 30,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
      {
        trigger: 'not_read',
        waitMinutes: 10,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    after(c, 31);
    await lab.followUps.tick();
    after(c, 500);
    await lab.followUps.tick();
    expect(lab.sent).toHaveLength(0);
    expect(await attempts(c)).toMatchObject([{ step_no: 1, outcome: 'lapsed' }]);
  });
});

describe('delivery of a follow-up message', () => {
  it('its delivery report lands on the step and goes to the wallet, which charges it once delivered', async () => {
    const c = await launch('fu-delivery', ['Asha'], async (w) => [
      {
        trigger: 'not_read',
        waitMinutes: 15,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
    ]);
    after(c, 16);
    await lab.followUps.tick();
    expect(await lab.flush()).toBe(1);
    const [a] = await attempts(c);
    expect(a).toMatchObject({ outcome: 'sent', delivery_status: 'delivered' });

    const events = (
      await owner().query(
        `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
        [c.orgId, MESSAGE_DELIVERY_EVENT],
      )
    ).rows.map((x) => walletDeliveryReportedSchema.parse(x.payload));
    expect(events.map((e) => [e.providerMessageId, e.status])).toContainEqual([
      a!.provider_message_id,
      'delivered',
    ]);

    // A read report moves the step on, a repeat or an older one changes nothing.
    await readReport(a!.provider_message_id as string, lab.clock.now);
    await lab.receipts.handle({
      providerMessageId: a!.provider_message_id as string,
      status: 'delivered',
      occurredAt: lab.clock.now,
    });
    expect((await attempts(c))[0]).toMatchObject({ delivery_status: 'read' });
  });
});

describe('the status of a run', () => {
  it('counts each step: waiting, sent, delivered, read, flows, skipped, lapsed, failed', async () => {
    const c = await launch('fu-status', ['Asha', 'Binod', 'Chitra'], async (w) => [
      {
        trigger: 'not_read',
        waitMinutes: 30,
        action: { kind: 'template', templateId: (await secondTemplate(w)).uuid },
      },
      {
        trigger: 'replied',
        waitMinutes: 600,
        action: { kind: 'flow', flowId: (await aFlow(w)).uuid },
      },
    ]);
    await readReport(c.who.Chitra!.wamid, new Date(c.start.getTime() + 5 * MIN));
    after(c, 31);
    await lab.followUps.tick();
    await lab.flush();

    const detail = await wiz(lab, (await world(lab, 'fu-status-other')).t.admin).get(
      `/broadcasts/${c.uuid}`,
    );
    expect(detail.status).toBe(404);

    const w = c.w;
    const res = await wiz(lab, w.t.admin).get(`/broadcasts/${c.uuid}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.runList[0].followUps).toEqual([
      {
        step: 1,
        waiting: 0,
        sent: 2,
        delivered: 2,
        read: 0,
        flowsStarted: 0,
        skipped: 1,
        lapsed: 0,
        failed: 0,
      },
      {
        step: 2,
        waiting: 2,
        sent: 0,
        delivered: 0,
        read: 0,
        flowsStarted: 0,
        skipped: 0,
        lapsed: 0,
        failed: 0,
      },
    ]);
  });
});
