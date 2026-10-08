import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simInbound } from '../chat-conversations/pipeline-support';
import { addBookingType, tapRow } from './commerce-support';
import {
  addFlow,
  edge,
  graph,
  node,
  simChannel,
  startFlowPipeline,
  runsOf,
  untilRun,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from './support';

let p: FlowPipeline;
beforeAll(async () => {
  p = await startFlowPipeline();
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

let counter = 0;
const nextPeer = () => `9196${String(20000000 + counter++).padStart(8, '0')}`;

const bookingFlow = (t: Tenant, data: Record<string, unknown> = {}) =>
  addFlow(p, t, {
    graph: graph(
      [
        node('b', 'book_appointment', { confirmation: '✅ Booked! See you on {{slot}}.', ...data }),
        node('ok', 'message', { text: 'Thanks {{name}}, company {{company}}' }),
        node('no', 'message', { text: 'No times, call us' }),
      ],
      [edge('b', 'ok', 'booked'), edge('b', 'no', 'no_slots')],
    ),
    trigger: { kind: 'keyword', keywords: 'bookme' },
  });

describe('the Book appointment node (TW-FLR-040)', () => {
  let t: Tenant;
  let ch: SimChannel;
  beforeAll(async () => {
    t = await p.api.signup('flrbook');
    ch = await simChannel(p as never, t);
  });

  it('walks a customer from the day to the time to the questions to a confirmed booking, and takes the booked port', async () => {
    const type = await addBookingType(p, t, {
      name: 'Consultation',
      questions: [{ label: 'Company', type: 'text', required: true }],
    });
    const f = await bookingFlow(t, { bookingTypeId: type.id });
    const peer = nextPeer();
    await simInbound(p, t, ch, { from: peer, name: 'Asha', text: 'bookme' });
    let sent = await untilSent(p, t, ch, peer, 1);
    expect(sent[0]).toContain('Pick a day:');

    await tapRow(p, t, ch, peer, 'bk_day_1');
    sent = await untilSent(p, t, ch, peer, 2);
    expect(sent[1]).toContain('Pick a time:');

    await tapRow(p, t, ch, peer, 'bk_slot_4');
    sent = await untilSent(p, t, ch, peer, 3);
    expect(sent[2]).toBe('Company');

    await simInbound(p, t, ch, { from: peer, name: 'Asha', text: 'Acme' });
    sent = await untilSent(p, t, ch, peer, 5);
    expect(sent[3]).toMatch(/^✅ Booked! See you on .+\d:\d\d [AP]M/);
    expect(sent[3]).toContain('Reschedule or cancel: ');
    expect(sent[4]).toBe('Thanks Asha, company Acme');
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(run.vars).toMatchObject({ company: 'Acme' });
    expect(String(run.vars.slot)).toMatch(/\d:\d\d [AP]M/);
    expect(run.vars.appointment_id).toBeTruthy();

    const appts = await p.h.owner.query(
      `SELECT status, source, invitee_name, invitee_phone, answers FROM appointments WHERE org_id = $1`,
      [t.orgId],
    );
    expect(appts.rows).toHaveLength(1);
    expect(appts.rows[0]).toMatchObject({ source: 'chat', invitee_name: 'Asha' });
    expect(JSON.stringify(appts.rows[0].answers)).toContain('Acme');
    const left = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM slot_reservations WHERE org_id = $1`,
      [t.orgId],
    );
    expect(left.rows[0].n).toBe(0);
  });

  it('asks which service first when there are several, and says so when a time was just taken', async () => {
    const t2 = await p.api.signup('flrbook2');
    const ch2 = await simChannel(p as never, t2);
    await addBookingType(p, t2, { name: 'Haircut' });
    await addBookingType(p, t2, { name: 'Massage' });
    const f = await bookingFlow(t2, { prompt: 'What would you like to book?' });
    const a = nextPeer();
    const b = nextPeer();
    await simInbound(p, t2, ch2, { from: a, name: 'A', text: 'bookme' });
    await simInbound(p, t2, ch2, { from: b, name: 'B', text: 'bookme' });
    expect((await untilSent(p, t2, ch2, a, 1))[0]).toContain('What would you like to book?');
    await untilSent(p, t2, ch2, b, 1);
    // Both pick the same service and day, so both are offered the same times.
    for (const who of [a, b]) {
      await tapRow(p, t2, ch2, who, 'bk_type_0');
      await untilSent(p, t2, ch2, who, 2);
      await tapRow(p, t2, ch2, who, 'bk_day_1');
      await untilSent(p, t2, ch2, who, 3);
    }
    await tapRow(p, t2, ch2, a, 'bk_slot_6');
    await untilSent(p, t2, ch2, a, 5);
    await tapRow(p, t2, ch2, b, 'bk_slot_6');
    const sent = await untilSent(p, t2, ch2, b, 5);
    expect(sent[3]).toBe('That time was just taken — here are the latest times.');
    expect(sent[4]).toContain('Pick a time:');
    // The first customer's service had no questions: booked at once. The second is still choosing a time, not failed.
    const runs = await runsOf(p, t2, f.id);
    expect(runs.find((r) => r.peer_key === a)?.status).toBe('completed');
    expect(runs.find((r) => r.peer_key === b)?.status).toBe('waiting');
  });

  it('answers a reply that is not on the list with a nudge and keeps the list open', async () => {
    const t3 = await p.api.signup('flrbook3');
    const ch3 = await simChannel(p as never, t3);
    await addBookingType(p, t3, { name: 'Only one' });
    await bookingFlow(t3);
    const peer = nextPeer();
    await simInbound(p, t3, ch3, { from: peer, name: 'C', text: 'bookme' });
    await untilSent(p, t3, ch3, peer, 1);
    await simInbound(p, t3, ch3, { from: peer, name: 'C', text: 'banana' });
    const sent = await untilSent(p, t3, ch3, peer, 2);
    expect(sent[1]).toBe("Sorry, I didn't catch that — tap one of the options.");
  });

  it('takes no_slots when the workspace has nothing to book, and when the plan has booking off', async () => {
    const t4 = await p.api.signup('flrbook4');
    const ch4 = await simChannel(p as never, t4);
    const f = await bookingFlow(t4);
    const peer = nextPeer();
    await simInbound(p, t4, ch4, { from: peer, name: 'D', text: 'bookme' });
    expect(await untilSent(p, t4, ch4, peer, 1)).toEqual(['No times, call us']);
    await untilRun(p, t4, f.id, 'done', (r) => r.status === 'completed');

    await addBookingType(p, t4, { name: 'Late' });
    await p.h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"appointment_booking":false}}' WHERE org_id = $1`,
      [t4.orgId],
    );
    const peer2 = nextPeer();
    await simInbound(p, t4, ch4, { from: peer2, name: 'D2', text: 'bookme' });
    expect(await untilSent(p, t4, ch4, peer2, 2)).toEqual([
      "Sorry, online booking isn't available right now.",
      'No times, call us',
    ]);
  });

  it('never books into another workspace: a type id of someone else is not offered', async () => {
    const t5 = await p.api.signup('flrbook5');
    const ch5 = await simChannel(p as never, t5);
    const other = await p.api.signup('flrbook6');
    const theirs = await addBookingType(p, other, { name: 'Theirs' });
    await addBookingType(p, t5, { name: 'Mine' });
    await bookingFlow(t5, { bookingTypeId: theirs.id });
    const peer = nextPeer();
    await simInbound(p, t5, ch5, { from: peer, name: 'E', text: 'bookme' });
    // The pinned id is unknown here, so the workspace's own single service is offered: its day list, never "Theirs".
    const sent = await untilSent(p, t5, ch5, peer, 1);
    expect(sent[0]).toContain('Pick a day:');
    await tapRow(p, t5, ch5, peer, 'bk_day_1');
    await untilSent(p, t5, ch5, peer, 2);
    await tapRow(p, t5, ch5, peer, 'bk_slot_5');
    await untilSent(p, t5, ch5, peer, 4);
    const appts = await p.h.owner.query(
      `SELECT org_id FROM appointments WHERE org_id IN ($1, $2)`,
      [t5.orgId, other.orgId],
    );
    expect(appts.rows.map((r) => Number(r.org_id))).toEqual([t5.orgId]);
  });
});
