import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { CampaignAudienceService } from '../../../src/modules/campaigns/audience.service';
import { ScheduleAudienceService } from '../../../src/modules/scheduled-queue-warmer/audience/schedule-audience.service';
import {
  bearer,
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
 * Target a previous send: the contacts an earlier broadcast or campaign went to, narrowed by what they did, as a source of the guided
 * wizard's audience, of the classic builder's recipients and of the Scheduled composer. Real Postgres, the sandbox sender.
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
/** A number the sandbox delivers to (last four digits decide what happens) or refuses (0000: undeliverable). */
const delivered = () => `+9199${String(3000 + phones++).padStart(4, '0')}1234`;
const refused = () => `+9199${String(3000 + phones++).padStart(4, '0')}0000`;

interface Sent {
  w: World;
  orgId: number;
  uuid: string;
  /** contact name -> the id of its recipient row */
  who: Record<string, number>;
}

/** A campaign sent to Asha, Binod, Chitra, Dev (delivered) and Esha (refused); Binod read it, Chitra replied, Dev clicked. */
async function sentCampaign(label: string): Promise<Sent> {
  const w = await world(lab, label);
  await payPerMessage(lab, w.t, 5_000_000);
  const spec = [
    ['Asha', delivered()],
    ['Binod', delivered()],
    ['Chitra', delivered()],
    ['Dev', delivered()],
    ['Esha', refused()],
  ] as const;
  const ids = await people(
    lab,
    w.t,
    spec.map(([name, phone]) => ({ name, phone })),
  );
  const g = await group(owner(), w.t, 'G', ids);
  const d = await makeDraft(lab, w, readyDraft(w, g));
  const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
    rowVersion: d.rowVersion,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const { id, orgId } = await idOfCampaign(owner(), d.id);
  lab.clock.now = new Date();
  expect(await lab.run(orgId, id)).toBe('finished');
  await lab.flush();
  const rows = await owner().query(
    `SELECT c.name, r.id, r.whatsapp_message_id FROM wp_campaign_contacts r
     JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id WHERE r.campaign_id = $1`,
    [id],
  );
  const who = Object.fromEntries(rows.rows.map((r) => [r.name as string, Number(r.id)]));
  const wamid = (name: string) =>
    rows.rows.find((r) => r.name === name)!.whatsapp_message_id as string;
  await lab.receipts.handle({
    providerMessageId: wamid('Binod'),
    status: 'read',
    occurredAt: new Date(),
  });
  await owner().query(
    `UPDATE wp_campaign_contacts SET responded_at = now(), response = 'Yes' WHERE id = $1`,
    [who.Chitra],
  );
  await owner().query(`UPDATE wp_campaign_contacts SET clicked = true WHERE id = $1`, [who.Dev]);
  return { w, orgId, uuid: d.id, who };
}

const count = async (s: Sent, previous: object) =>
  (
    await wiz(lab, s.w.t.admin).post('/audience/count', {
      audience: { previous },
    })
  ).body as { recipients: number };

const names = async (orgId: number, ids: number[]) =>
  (
    await owner().query(
      `SELECT name FROM contacts WHERE org_id = $1 AND id = ANY($2) ORDER BY name`,
      [orgId, ids],
    )
  ).rows.map((r) => r.name as string);

describe('the wizard audience: previous sends', () => {
  it('lists the earlier campaigns with how many people each outcome holds', async () => {
    const s = await sentCampaign('prev-list');
    const res = await wiz(lab, s.w.t.admin).get('/audience-sources');
    expect(res.status).toBe(200);
    const row = res.body.previousSends.find((p: { id: string }) => p.id === s.uuid);
    expect(row).toMatchObject({
      kind: 'campaign',
      recipients: 5,
      delivered: 4,
      read: 2,
      replied: 1,
      clicked: 1,
      failed: 1,
    });
  });

  it('counts the contacts of a campaign by outcome, and narrows nobody it should not', async () => {
    const s = await sentCampaign('prev-count');
    const send = [{ kind: 'campaign', id: s.uuid }];
    // Esha's number is a valid number (the sandbox refuses it at send time), so she is a recipient of the earlier send.
    expect((await count(s, { sends: send, outcome: 'all' })).recipients).toBe(5);
    expect((await count(s, { sends: send, outcome: 'delivered' })).recipients).toBe(4);
    // A reply means they saw it: Binod read it and Chitra replied; Asha and Dev did not read it.
    expect((await count(s, { sends: send, outcome: 'read' })).recipients).toBe(2);
    expect((await count(s, { sends: send, outcome: 'not_read' })).recipients).toBe(2);
    expect((await count(s, { sends: send, outcome: 'replied' })).recipients).toBe(1);
    expect((await count(s, { sends: send, outcome: 'not_replied' })).recipients).toBe(3);
    expect((await count(s, { sends: send, outcome: 'clicked' })).recipients).toBe(1);
    expect((await count(s, { sends: send, outcome: 'failed' })).recipients).toBe(1);
  });

  it('does not reach a send of another workspace', async () => {
    const mine = await sentCampaign('prev-mine');
    const other = await sentCampaign('prev-other');
    const res = await count(mine, {
      sends: [{ kind: 'campaign', id: other.uuid }],
      outcome: 'all',
    });
    expect(res.recipients).toBe(0);
  });

  it('refuses to narrow a broadcast by replies or clicks, and takes at most 20 sends', async () => {
    const s = await sentCampaign('prev-rules');
    const broadcast = await wiz(lab, s.w.t.admin).post('/audience/count', {
      audience: {
        previous: {
          sends: [{ kind: 'broadcast', id: '00000000-0000-4000-8000-000000000000' }],
          outcome: 'replied',
        },
      },
    });
    expect(broadcast.status).toBe(422);
    const many = await wiz(lab, s.w.t.admin).post('/audience/count', {
      audience: {
        previous: {
          sends: Array.from({ length: 21 }, () => ({ kind: 'campaign', id: s.uuid })),
          outcome: 'all',
        },
      },
    });
    expect(many.status).toBe(422);
  });

  it('a new broadcast aimed at those who did not read the last one messages exactly them', async () => {
    const s = await sentCampaign('prev-launch');
    const d = await makeDraft(
      lab,
      s.w,
      readyDraft(s.w, '', {
        audience: {
          groupIds: [],
          segmentIds: [],
          rules: null,
          previous: { sends: [{ kind: 'campaign', id: s.uuid }], outcome: 'not_read' },
        },
      }),
    );
    const res = await wiz(lab, s.w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { id } = await idOfCampaign(owner(), d.id);
    const got = await owner().query(
      `SELECT c.name FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
       WHERE r.campaign_id = $1 ORDER BY c.name`,
      [id],
    );
    expect(got.rows.map((r) => r.name)).toEqual(['Asha', 'Dev']);
  });
});

describe('the classic builder and the Scheduled composer', () => {
  it('the classic builder resolves a previous send by outcome, and lists it in the builder data', async () => {
    const s = await sentCampaign('prev-classic');
    const audience = lab.h.app.get(CampaignAudienceService, { strict: false });
    const ids = await lab.h.app
      .get(DatabaseService, { strict: false })
      .txAs({ orgId: s.orgId }, (tx) =>
        audience.resolve(tx, s.orgId, null, {
          previousSends: { sends: [{ kind: 'campaign', id: s.uuid }], outcome: 'replied' },
        }),
      );
    expect(await names(s.orgId, ids)).toEqual(['Chitra']);

    const builder = await lab.api.http().get('/v2/campaigns/builder').set(bearer(s.w.t.admin));
    expect(builder.status).toBe(200);
    expect(builder.body.previousSends.map((p: { id: string }) => p.id)).toContain(s.uuid);
  });

  it('the Scheduled composer lists a campaign beside the broadcasts and targets its contacts', async () => {
    const s = await sentCampaign('prev-sched');
    const options = await lab.api.http().get('/v2/scheduled/options').set(bearer(s.w.t.admin));
    expect(options.status, JSON.stringify(options.body)).toBe(200);
    expect(options.body.queues).toContainEqual(
      expect.objectContaining({ id: s.uuid, kind: 'campaign', recipients: 5 }),
    );
    const audience = lab.h.app.get(ScheduleAudienceService, { strict: false });
    const resolved = await lab.h.app
      .get(DatabaseService, { strict: false })
      .txAs({ orgId: s.orgId }, (tx) =>
        audience.resolve(tx, s.orgId, { recipientType: 'queue', queueIds: [s.uuid] }),
      );
    expect(resolved.recipients).toHaveLength(5);
  });
});
