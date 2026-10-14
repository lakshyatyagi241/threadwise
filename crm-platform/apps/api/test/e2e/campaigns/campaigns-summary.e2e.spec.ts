import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  campaignSummaryPeopleSchema,
  campaignSummarySchema,
  summaryFormsResponseSchema,
} from '@crm/contracts';
import { FormsApi, startHarness, type Harness } from '../forms-builder/support';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  campaign,
  channel,
  nextDigits,
  person,
  recipient,
  replyLater,
  thread,
  waForm,
  waSubmission,
  webForm,
  webSubmission,
  type Person,
  type WebForm,
} from './summary.support';

/**
 * The director summary of a campaign (an owner-requested addition): distinct people messaged, delivered, read, who wrote back and who
 * filled an application form, from the real inbox and form tables in a real Postgres.
 */
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
const summary = (token: string, id: string, qs = '') =>
  get(token, `/v2/campaigns/${id}/summary${qs}`);
const people = (token: string, id: string, qs: string) =>
  get(token, `/v2/campaigns/${id}/summary/people?${qs}`);

interface World {
  t: Tenant;
  camp: { id: number; uuid: string };
  p: Record<string, Person>;
  f1: WebForm;
  f2: WebForm;
  w1: { id: number; uuid: string; name: string };
  hana: string;
}

/**
 * Twelve people messaged at the same instant, each a different edge of "wrote back" or "filled a form". Hours are after the send.
 *   A  wrote twice (+1h, +2h)            -> counts once, first reply +1h; filled the other form (+26h)
 *   B  wrote before the send (-1h)       -> not back; a form filled before the send (-2h)
 *   C  wrote after 8 days                -> back only with the 14 day window; a form still under review
 *   D  only reacted (+1h)                -> not back; a failed form
 *   E  wrote in a group (+1h)            -> not back; a form still received
 *   F  opted out, wrote (+1h)            -> not back, caveat
 *   G  recipient has no contact id, but its phone is a contact's; wrote +3h; WhatsApp form (+24h); a spam web form
 *   H  no contact at all, a thread by phone; wrote +2h (name 'Hana')
 *   I  no contact, no thread: untrackable
 *   J  wrote +20h; web form +2h and +3h (paid); WhatsApp form +4h
 *   K  the send failed
 *   L  deleted message and an agent message only; a form awaiting payment (+1h)
 */
async function world(label: string): Promise<World> {
  const t = await api.workspace(label);
  const o = h.owner;
  const ch = await channel(o, t);
  const camp = await campaign(o, t, 'Admissions push');
  const f1 = await webForm(h, api, t, 'Admission form');
  const f2 = await webForm(h, api, t, 'Other form');
  const w1 = await waForm(o, t, 'WA apply');
  const p: Record<string, Person> = {};
  for (const n of 'ABCDEFGJKL') p[n] = await person(o, t, `Person ${n}`, { optedOut: n === 'F' });
  const hDigits = nextDigits();
  const iDigits = nextDigits();
  const hana = hDigits;

  const sent = (n: string, status: string, extra: object = {}) =>
    recipient(o, t, camp.id, { contactId: p[n]!.id, status, ...extra });
  await sent('A', 'read', { read: true });
  await sent('B', 'delivered', { delivered: true });
  await sent('C', 'sent');
  await sent('D', 'read', { read: true });
  await sent('E', 'delivered', { delivered: true });
  await sent('F', 'unsubscribed', { optedOut: true });
  await recipient(o, t, camp.id, {
    phone: `+${p.G!.digits.slice(0, 2)} ${p.G!.digits.slice(2)}`,
    status: 'delivered',
    delivered: true,
  });
  await recipient(o, t, camp.id, { phone: `+${hDigits}`, name: 'Hana', status: 'sent' });
  await recipient(o, t, camp.id, { phone: `+${iDigits}`, name: 'Ivy', status: 'sent' });
  await sent('J', 'read', { read: true });
  await sent('K', 'failed', { sentH: null });
  await sent('L', 'sent');

  await thread(o, t, ch, p.A!.digits, p.A!.id, [{ h: 1 }, { h: 2 }]);
  await thread(o, t, ch, p.B!.digits, p.B!.id, [{ h: -1 }]);
  await thread(o, t, ch, p.C!.digits, p.C!.id, [{ h: 192 }]);
  await thread(o, t, ch, p.D!.digits, p.D!.id, [{ h: 1, kind: 'reaction' }]);
  await thread(o, t, ch, 'g:120363000000000001', p.E!.id, [{ h: 1 }]);
  await thread(o, t, ch, p.F!.digits, p.F!.id, [{ h: 1 }]);
  await thread(o, t, ch, p.G!.digits, p.G!.id, [{ h: 3 }]);
  await thread(o, t, ch, hDigits, null, [{ h: 2 }]);
  await thread(o, t, ch, p.J!.digits, p.J!.id, [{ h: 20 }]);
  await thread(o, t, ch, p.L!.digits, p.L!.id, [
    { h: 1, dir: 'out' },
    { h: 1, deleted: true },
  ]);

  await webSubmission(o, t, f1, p.J!.id, 'created', 2);
  await webSubmission(o, t, f1, p.J!.id, 'paid', 3);
  await waSubmission(o, t, w1.id, p.J!.id, 4);
  await webSubmission(o, t, f2, p.A!.id, 'updated', 26);
  await webSubmission(o, t, f1, p.G!.id, 'spam', 1);
  await waSubmission(o, t, w1.id, p.G!.id, 24);
  await webSubmission(o, t, f1, p.B!.id, 'created', -2);
  await webSubmission(o, t, f1, p.C!.id, 'needs_review', 1);
  await webSubmission(o, t, f1, p.D!.id, 'failed', 1);
  await webSubmission(o, t, f1, p.E!.id, 'received', 1);
  await webSubmission(o, t, f1, p.L!.id, 'awaiting_payment', 1);
  await webSubmission(o, t, f1, null, 'created', 2);
  const stranger = await person(o, t, 'Stranger');
  await webSubmission(o, t, f1, stranger.id, 'created', 2);
  await waSubmission(o, t, w1.id, null, 2);
  return { t, camp, p, f1, f2, w1, hana };
}

let w: World;
beforeAll(async () => {
  w = await world('sum');
}, 240_000);

describe('the figures', () => {
  it('counts distinct people messaged, delivered, read and failed from the same roll-up as the detail page', async () => {
    const res = await summary(w.t.admin, w.camp.uuid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = campaignSummarySchema.parse(res.body);
    expect(s.kind).toBe('campaign');
    expect(s.id).toBe(w.camp.uuid);
    expect(s.name).toBe('Admissions push');
    expect(s.sentAt).toBe('2026-09-10T06:00:00.000Z');
    expect(s.window).toEqual({
      days: 7,
      from: '2026-09-10T06:00:00.000Z',
      to: '2026-09-17T06:00:00.000Z',
    });
    expect(s.people).toEqual({ messaged: 11, delivered: 6, read: 3, failed: 1, notTrackable: 1 });
  });

  it('counts a person once however often they wrote, and only inside their own window', async () => {
    const s = campaignSummarySchema.parse((await summary(w.t.admin, w.camp.uuid)).body);
    // A (twice), G (no contact id on the row, found by phone), H (thread by phone, no contact), J. Not: B before the send, C after
    // the window, D a reaction, E a group, F opted out, L deleted and agent messages only.
    expect(s.cameBack.count).toBe(4);
    expect(s.cameBack.pctOfMessaged).toBe(36.4);
    expect(s.cameBack.pctOfDelivered).toBe(66.7);
    expect(s.cameBack.medianHoursToReply).toBe(2.5); // 1h, 2h, 3h, 20h
    expect(s.cameBackByDay).toEqual([
      { day: '2026-09-10', count: 3 },
      { day: '2026-09-11', count: 1 },
    ]);
  });

  it('widens to a person who wrote on day 8 with the 14 day window, and the median follows', async () => {
    const s = campaignSummarySchema.parse(
      (await summary(w.t.admin, w.camp.uuid, '?cameBackDays=14')).body,
    );
    expect(s.window.days).toBe(14);
    expect(s.window.to).toBe('2026-09-24T06:00:00.000Z');
    expect(s.cameBack.count).toBe(5);
    expect(s.cameBack.medianHoursToReply).toBe(3); // 1, 2, 3, 20, 192
    expect(s.cameBackByDay.map((d) => d.day)).toEqual(['2026-09-10', '2026-09-11', '2026-09-18']);
    const three = campaignSummarySchema.parse(
      (await summary(w.t.admin, w.camp.uuid, '?cameBackDays=3')).body,
    );
    expect(three.cameBack.count).toBe(4);
  });

  it('counts the people who filled an accepted form after the send, any form when none is picked', async () => {
    const s = campaignSummarySchema.parse((await summary(w.t.admin, w.camp.uuid)).body);
    // J (web twice, WhatsApp), A (other form), G (WhatsApp), L (awaiting payment). Not: spam, failed, received, needs review, before
    // the send, no contact, a contact that was not messaged.
    expect(s.filledForm).toMatchObject({
      count: 4,
      pctOfMessaged: 36.4,
      alsoWroteBack: 3,
      viaWebForm: 3,
      viaWhatsappForm: 2,
      allForms: true,
    });
    expect(s.filledForm!.formsCounted.map((f) => f.name).sort()).toEqual([
      'Admission form',
      'Other form',
      'WA apply',
    ]);
  });

  it('counts only the picked forms (web and WhatsApp), and a pick that matches nothing counts nothing', async () => {
    const one = campaignSummarySchema.parse(
      (await summary(w.t.admin, w.camp.uuid, `?formIds=${w.f1.uuid}`)).body,
    );
    expect(one.filledForm).toMatchObject({
      count: 2, // J and L
      alsoWroteBack: 1,
      viaWebForm: 2,
      viaWhatsappForm: 0,
      allForms: false,
    });
    expect(one.filledForm!.formsCounted).toEqual([
      { id: w.f1.uuid, kind: 'web', name: 'Admission form' },
    ]);

    const mixed = campaignSummarySchema.parse(
      (await summary(w.t.admin, w.camp.uuid, `?formIds=${w.f1.uuid},${w.w1.uuid}`)).body,
    );
    expect(mixed.filledForm).toMatchObject({ count: 3, viaWebForm: 2, viaWhatsappForm: 2 }); // J, L, G

    const wa = campaignSummarySchema.parse(
      (await summary(w.t.admin, w.camp.uuid, `?formIds=${w.w1.uuid}`)).body,
    );
    expect(wa.filledForm).toMatchObject({ count: 2, alsoWroteBack: 2, viaWebForm: 0 });

    const ghost = campaignSummarySchema.parse(
      (await summary(w.t.admin, w.camp.uuid, '?formIds=3f2b8f0e-2f6e-4a5b-9d0e-6c1b7a9a1111')).body,
    );
    expect(ghost.filledForm).toMatchObject({ count: 0, allForms: false, formsCounted: [] });
  });

  it('says why a number is a floor', async () => {
    const s = campaignSummarySchema.parse((await summary(w.t.admin, w.camp.uuid)).body);
    expect(s.caveats).toEqual([
      'recipients_without_contact',
      'contact_match_only',
      'opted_out_excluded',
    ]);
  });

  it('warns when another campaign messaged the same people inside the window', async () => {
    // Earlier tests left this window in the one-minute cache.
    const keys = await h.redis.keys(`camp-summary:${w.t.orgId}:*`);
    if (keys.length > 0) await h.redis.del(...keys);
    const other = await campaign(h.owner, w.t, 'Second push');
    await recipient(h.owner, w.t, other.id, {
      contactId: w.p.A!.id,
      status: 'sent',
      sentH: 24,
    });
    const withOther = campaignSummarySchema.parse(
      (await summary(w.t.admin, w.camp.uuid, '?cameBackDays=3')).body,
    );
    expect(withOther.caveats).toContain('counted_in_other_campaigns');
    // The other campaign sees the first one the same way.
    const mirror = campaignSummarySchema.parse((await summary(w.t.admin, other.uuid)).body);
    expect(mirror.people.messaged).toBe(1);
  });

  it('is empty, not an error, before anything was sent', async () => {
    const t = await api.workspace('sumempty');
    const c = await campaign(h.owner, t, 'Draft');
    await recipient(h.owner, t, c.id, { phone: '+919876500001', status: 'queued', sentH: null });
    const res = await summary(t.admin, c.uuid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = campaignSummarySchema.parse(res.body);
    expect(s.sentAt).toBeNull();
    expect(s.window.from).toBeNull();
    expect(s.people).toEqual({ messaged: 0, delivered: 0, read: 0, failed: 0, notTrackable: 0 });
    expect(s.cameBack).toEqual({
      count: 0,
      pctOfMessaged: 0,
      pctOfDelivered: 0,
      medianHoursToReply: null,
    });
    expect(s.cameBackByDay).toEqual([]);
  });
});

describe('the people behind the figures', () => {
  it('lists who wrote back, newest first, in keyset pages, with a person that has no contact', async () => {
    const first = await people(w.t.admin, w.camp.uuid, 'kind=came_back&limit=2');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const a = campaignSummaryPeopleSchema.parse(first.body);
    expect(a.total).toBe(4);
    expect(a.data.map((x) => x.name)).toEqual(['Person J', 'Person G']);
    expect(a.data[0]).toMatchObject({
      contactId: w.p.J!.uuid,
      phone: `+${w.p.J!.digits}`,
      at: '2026-09-11T02:00:00.000Z',
      formName: null,
    });
    expect(a.nextCursor).not.toBeNull();

    const second = campaignSummaryPeopleSchema.parse(
      (
        await people(
          w.t.admin,
          w.camp.uuid,
          `kind=came_back&limit=2&cursor=${encodeURIComponent(a.nextCursor!)}`,
        )
      ).body,
    );
    expect(second.data.map((x) => x.name)).toEqual(['Hana', 'Person A']);
    expect(second.data[0]).toMatchObject({ contactId: null, phone: `+${w.hana}` });
    expect(second.nextCursor).toBeNull();
    expect(second.total).toBe(4);
  });

  it('lists who filled a form with the first form they filled', async () => {
    const res = await people(w.t.admin, w.camp.uuid, 'kind=filled_form&limit=3');
    const a = campaignSummaryPeopleSchema.parse(res.body);
    expect(a.total).toBe(4);
    expect(a.data.map((x) => [x.name, x.formName])).toEqual([
      ['Person A', 'Other form'],
      ['Person G', 'WA apply'],
      ['Person J', 'Admission form'],
    ]);
    const b = campaignSummaryPeopleSchema.parse(
      (
        await people(
          w.t.admin,
          w.camp.uuid,
          `kind=filled_form&limit=3&cursor=${encodeURIComponent(a.nextCursor!)}`,
        )
      ).body,
    );
    expect(b.data.map((x) => x.name)).toEqual(['Person L']);
    expect(b.nextCursor).toBeNull();

    const picked = campaignSummaryPeopleSchema.parse(
      (await people(w.t.admin, w.camp.uuid, `kind=filled_form&formIds=${w.f2.uuid}`)).body,
    );
    expect(picked.data.map((x) => x.name)).toEqual(['Person A']);
  });

  it('lists the recipients the send did not reach', async () => {
    const res = await people(w.t.admin, w.camp.uuid, 'kind=not_reached');
    const a = campaignSummaryPeopleSchema.parse(res.body);
    expect(a.total).toBe(1);
    expect(a.data[0]).toMatchObject({ contactId: w.p.K!.uuid, name: 'Person K' });
    expect(a.nextCursor).toBeNull();
  });

  it('refuses a limit over 100, an unknown kind and a cursor that is not ours', async () => {
    for (const qs of ['kind=came_back&limit=101', 'kind=nope', 'kind=came_back&cursor=%7Bnope']) {
      const res = await people(w.t.admin, w.camp.uuid, qs);
      expect(res.status, qs).toBe(422);
    }
  });
});

describe('who may see what', () => {
  it('refuses an invalid window and an unknown form id with 422', async () => {
    for (const qs of ['?cameBackDays=5', '?cameBackDays=0', '?formIds=not-a-uuid']) {
      const res = await summary(w.t.admin, w.camp.uuid, qs);
      expect(res.status, qs).toBe(422);
    }
  });

  it('hides the form figures from a caller who may not read form submissions', async () => {
    const viewer = await api.member(w.t, 'viewer', [['camp.campaigns.read']]);
    const s = campaignSummarySchema.parse((await summary(viewer.token, w.camp.uuid)).body);
    expect(s.filledForm).toBeNull();
    expect(s.caveats).not.toContain('contact_match_only');
    expect(s.cameBack.count).toBe(4);
    // Naming a form does not get around it, and the full entry the admin cached is not shared with them.
    const named = campaignSummarySchema.parse(
      (await summary(viewer.token, w.camp.uuid, `?formIds=${w.f1.uuid}`)).body,
    );
    expect(named.filledForm).toBeNull();

    const denied = await people(viewer.token, w.camp.uuid, 'kind=filled_form');
    expect(denied.status).toBe(403);
    const ok = await people(viewer.token, w.camp.uuid, 'kind=came_back');
    expect(ok.status).toBe(200);

    const reader = await api.member(w.t, 'reader', [
      ['camp.campaigns.read'],
      ['record.form-submissions.read'],
    ]);
    const full = campaignSummarySchema.parse((await summary(reader.token, w.camp.uuid)).body);
    expect(full.filledForm?.count).toBe(4);
    expect((await people(reader.token, w.camp.uuid, 'kind=filled_form')).status).toBe(200);
  });

  it('needs camp.campaigns.read', async () => {
    const nobody = await api.member(w.t, 'nobody', [['bcast.broadcasts.read']]);
    expect((await summary(nobody.token, w.camp.uuid)).status).toBe(403);
    expect((await people(nobody.token, w.camp.uuid, 'kind=came_back')).status).toBe(403);
    expect((await get(nobody.token, '/v2/campaigns/summary/forms')).status).toBe(403);
  });

  it('lists the forms to pick only to a caller who may read forms', async () => {
    const res = await get(w.t.admin, '/v2/campaigns/summary/forms');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const forms = summaryFormsResponseSchema.parse(res.body);
    expect(forms.data).toEqual([
      { id: w.f1.uuid, kind: 'web', name: 'Admission form' },
      { id: w.f2.uuid, kind: 'web', name: 'Other form' },
      { id: w.w1.uuid, kind: 'whatsapp', name: 'WA apply' },
    ]);
    const viewer = await api.member(w.t, 'pickless', [['camp.campaigns.read']]);
    expect((await get(viewer.token, '/v2/campaigns/summary/forms')).body.data).toEqual([]);
    const reader = await api.member(w.t, 'picker', [
      ['camp.campaigns.read'],
      ['record.forms.read'],
    ]);
    expect((await get(reader.token, '/v2/campaigns/summary/forms')).body.data).toHaveLength(3);
  });

  it('answers 404 for a campaign of another workspace, on every route', async () => {
    const other = await api.workspace('sumother');
    for (const path of [
      `/v2/campaigns/${w.camp.uuid}/summary`,
      `/v2/campaigns/${w.camp.uuid}/summary/people?kind=came_back`,
      `/v2/campaigns/${w.camp.uuid}/summary/people?kind=not_reached`,
    ]) {
      const res = await get(other.admin, path);
      expect(res.status, path).toBe(404);
    }
    // And its forms are not another workspace's picker.
    const forms = await get(other.admin, '/v2/campaigns/summary/forms');
    expect(forms.body.data).toEqual([]);
    expect(
      (await get(w.t.admin, `/v2/campaigns/00000000-0000-4000-8000-000000000000/summary`)).status,
    ).toBe(404);
  });
});

describe('the one-minute cache', () => {
  it('serves a repeat from Redis for the same window and forms, and a different window separately', async () => {
    const t = await api.workspace('sumcache');
    const o = h.owner;
    const ch = await channel(o, t);
    const c = await campaign(o, t, 'Cached');
    const a = await person(o, t, 'Cara');
    await recipient(o, t, c.id, { contactId: a.id, status: 'read', read: true });
    const conv = await thread(o, t, ch, a.digits, a.id, [{ h: 1 }]);

    const first = campaignSummarySchema.parse((await summary(t.admin, c.uuid)).body);
    expect(first.cameBack.count).toBe(1);

    // Someone new writes, but the entry is a minute old at most.
    const b = await person(o, t, 'Bea');
    await recipient(o, t, c.id, { contactId: b.id, status: 'read', read: true });
    await thread(o, t, ch, b.digits, b.id, [{ h: 2 }]);
    await replyLater(o, t, conv, 3);
    const again = campaignSummarySchema.parse((await summary(t.admin, c.uuid)).body);
    expect(again).toEqual(first);

    const keys = await h.redis.keys(`camp-summary:${t.orgId}:*`);
    expect(keys.length).toBeGreaterThan(0);
    const ttl = await h.redis.ttl(keys[0]!);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    // Another window is its own entry and sees the new person.
    const wide = campaignSummarySchema.parse(
      (await summary(t.admin, c.uuid, '?cameBackDays=14')).body,
    );
    expect(wide.cameBack.count).toBe(2);

    await h.redis.del(...keys);
    const fresh = campaignSummarySchema.parse((await summary(t.admin, c.uuid)).body);
    expect(fresh.cameBack.count).toBe(2);
  });

  it("keeps a workspace out of another one's entries", async () => {
    const other = await api.workspace('sumcache2');
    const res = await summary(other.admin, w.camp.uuid);
    expect(res.status).toBe(404);
  });
});
