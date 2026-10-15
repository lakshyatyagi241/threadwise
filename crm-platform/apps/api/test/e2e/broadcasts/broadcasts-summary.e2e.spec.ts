import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignSummaryPeopleSchema, campaignSummarySchema } from '@crm/contracts';
import { FormsApi, startHarness, type Harness } from '../forms-builder/support';
import {
  broadcast,
  broadcastRecipient,
  channel,
  person,
  thread,
  webForm,
  webSubmission,
} from '../campaigns/summary.support';

/** The director summary of a legacy broadcast: the same shapes as a campaign's, read from `broadcast_contacts`. */
let h: Harness;
let api: FormsApi;

beforeAll(async () => {
  h = await startHarness();
  api = new FormsApi(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const get = (token: string, path: string) => api.as(token).get(path);

async function world() {
  const t = await api.workspace('bsum');
  const o = h.owner;
  const ch = await channel(o, t);
  const b = await broadcast(o, t, 'Open day reminder');
  const form = await webForm(h, api, t, 'Admission form');
  const r1 = await person(o, t, 'Ria'); // read it, wrote back twice, filled the form
  const r2 = await person(o, t, 'Raj'); // delivered, silent
  const r3 = await person(o, t, 'Rex'); // the send failed
  const r4 = await person(o, t, 'Rue', { optedOut: true }); // opted out, wrote back
  const r5 = await person(o, t, 'Roy'); // sent only, filled the form without writing
  await broadcastRecipient(o, t, b.id, r1.id, 'read');
  await broadcastRecipient(o, t, b.id, r2.id, 'delivered');
  await broadcastRecipient(o, t, b.id, r3.id, 'failed', null);
  await broadcastRecipient(o, t, b.id, r4.id, 'delivered');
  await broadcastRecipient(o, t, b.id, r5.id, 'sent');
  await thread(o, t, ch, r1.digits, r1.id, [{ h: 2 }, { h: 5 }]);
  await thread(o, t, ch, r4.digits, r4.id, [{ h: 1 }]);
  await webSubmission(o, t, form, r1.id, 'created', 3);
  await webSubmission(o, t, form, r5.id, 'paid', 30);
  return { t, b, form, r1, r5, r3 };
}

describe('GET /v2/broadcasts/:id/summary', () => {
  it('counts people from the broadcast recipients, the inbox and the forms', async () => {
    const w = await world();
    const res = await get(w.t.admin, `/v2/broadcasts/${w.b.uuid}/summary`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = campaignSummarySchema.parse(res.body);
    expect(s.kind).toBe('broadcast');
    expect(s.id).toBe(w.b.uuid);
    expect(s.name).toBe('Open day reminder');
    expect(s.people).toEqual({ messaged: 4, delivered: 3, read: 1, failed: 1, notTrackable: 0 });
    expect(s.cameBack).toEqual({
      count: 1,
      pctOfMessaged: 25,
      pctOfDelivered: 33.3,
      medianHoursToReply: 2,
    });
    expect(s.cameBackByDay).toEqual([{ day: '2026-09-10', count: 1 }]);
    expect(s.filledForm).toMatchObject({
      count: 2,
      pctOfMessaged: 50,
      alsoWroteBack: 1,
      viaWebForm: 2,
      viaWhatsappForm: 0,
    });
    // The opted-out contact wrote back and is left out; both forms were the contact messaged.
    expect(s.caveats).toEqual(['contact_match_only', 'opted_out_excluded']);

    const picked = campaignSummarySchema.parse(
      (
        await get(
          w.t.admin,
          `/v2/broadcasts/${w.b.uuid}/summary?cameBackDays=3&formIds=${w.form.uuid}`,
        )
      ).body,
    );
    expect(picked.filledForm).toMatchObject({ count: 2, allForms: false });
    expect(picked.window.days).toBe(3);
  });

  it('lists the people behind the figures, and who the send did not reach', async () => {
    const w = await world();
    const back = campaignSummaryPeopleSchema.parse(
      (await get(w.t.admin, `/v2/broadcasts/${w.b.uuid}/summary/people?kind=came_back`)).body,
    );
    expect(back.total).toBe(1);
    expect(back.data[0]).toMatchObject({
      name: 'Ria',
      contactId: w.r1.uuid,
      at: '2026-09-10T08:00:00.000Z',
    });

    const forms = campaignSummaryPeopleSchema.parse(
      (await get(w.t.admin, `/v2/broadcasts/${w.b.uuid}/summary/people?kind=filled_form`)).body,
    );
    expect(forms.data.map((p) => [p.name, p.formName])).toEqual([
      ['Roy', 'Admission form'],
      ['Ria', 'Admission form'],
    ]);

    const miss = campaignSummaryPeopleSchema.parse(
      (await get(w.t.admin, `/v2/broadcasts/${w.b.uuid}/summary/people?kind=not_reached`)).body,
    );
    expect(miss.data.map((p) => p.name)).toEqual(['Rex']);
  });

  it('follows the broadcast permissions and the form permission', async () => {
    const w = await world();
    const campaignsOnly = await api.member(w.t, 'camponly', [['camp.campaigns.read']]);
    expect((await get(campaignsOnly.token, `/v2/broadcasts/${w.b.uuid}/summary`)).status).toBe(403);

    const viewer = await api.member(w.t, 'bviewer', [['bcast.broadcasts.read']]);
    const s = campaignSummarySchema.parse(
      (await get(viewer.token, `/v2/broadcasts/${w.b.uuid}/summary`)).body,
    );
    expect(s.filledForm).toBeNull();
    expect(
      (await get(viewer.token, `/v2/broadcasts/${w.b.uuid}/summary/people?kind=filled_form`))
        .status,
    ).toBe(403);
    expect(
      (await get(viewer.token, `/v2/broadcasts/${w.b.uuid}/summary/people?kind=came_back`)).status,
    ).toBe(200);
  });

  it('answers 404 for another workspace, an unknown id, a campaign id, and 422 for a bad window', async () => {
    const w = await world();
    const other = await api.workspace('bsum2');
    expect((await get(other.admin, `/v2/broadcasts/${w.b.uuid}/summary`)).status).toBe(404);
    expect(
      (await get(other.admin, `/v2/broadcasts/${w.b.uuid}/summary/people?kind=came_back`)).status,
    ).toBe(404);
    expect(
      (await get(w.t.admin, '/v2/broadcasts/00000000-0000-4000-8000-000000000000/summary')).status,
    ).toBe(404);
    expect((await get(w.t.admin, `/v2/broadcasts/${w.b.uuid}/summary?cameBackDays=9`)).status).toBe(
      422,
    );
    // The list's own `summary` route (tiles) still answers where it did.
    expect((await get(w.t.admin, '/v2/broadcasts/summary')).status).toBe(200);
  });
});
