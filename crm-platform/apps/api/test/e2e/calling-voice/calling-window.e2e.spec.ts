import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SendWindowService } from '../../../src/modules/compliance-center';
import { SDP_OFFER, addNumber, deliver, startCallPipeline, type CallPipeline } from './support';

/**
 * The calling window at the dialler (BL-177). A live call cannot be held, so a business-initiated call outside the hours the workspace
 * set is REFUSED, with the instant the window opens, before anything is asked of Meta. A call back to someone who reached us in the last
 * day is service and goes through. The real API and Postgres, a fake Meta and a fixed clock.
 */
let p: CallPipeline;
let window: SendWindowService;

/** Thursday 2026-10-15 at the given UTC time. */
const at = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00Z`);
/** 21:30 in India: outside 09:00 to 17:00. */
const EVENING = at('16:00');
/** 12:30 in India: inside. */
const MIDDAY = at('07:00');
const CUSTOMER = '919811100001';

beforeAll(async () => {
  p = await startCallPipeline();
  window = p.h.app.get(SendWindowService);
}, 300_000);
afterAll(async () => {
  await p?.stop();
});
beforeEach(() => {
  window.now = () => EVENING;
});

async function setup(label: string, o: { window?: boolean } = {}) {
  const t = await p.api.signup(label);
  const number = await addNumber(p, t);
  if (o.window !== false) {
    await p.h.owner.query(
      `INSERT INTO compliance_settings (org_id, calling_window_enabled, calling_start, calling_end, calling_days)
       VALUES ($1, true, '09:00', '17:00', '{1,2,3,4,5}')`,
      [t.orgId],
    );
  }
  p.meta.reset();
  return { t, number };
}

const dial = (t: { admin: string }, numberId: string, to = CUSTOMER) =>
  p.api.as(t.admin).post('/v2/calling/calls/dial').send({ numberId, to, sdpOffer: SDP_OFFER });
const callCount = async (orgId: number) =>
  (await p.h.owner.query(`SELECT count(*)::int AS n FROM wa_calls WHERE org_id = $1`, [orgId]))
    .rows[0].n as number;

describe('BL-177: the calling window at the dialler', () => {
  it('refuses a call outside the window, says when it opens, and asks Meta nothing', async () => {
    const { t, number } = await setup('cw1');
    const r = await dial(t, number.uuid);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('CALL_OUTSIDE_WINDOW');
    // Thursday 21:30 in India: the window opens Friday 09:00 = 03:30 UTC.
    expect(JSON.stringify(r.body)).toContain('2026-10-16T03:30:00.000Z');
    expect(JSON.stringify(r.body)).toContain('opensAt');
    // No permission request went out, no call was placed, no call row was written.
    expect(p.meta.messages()).toHaveLength(0);
    expect(p.meta.action('connect')).toHaveLength(0);
    expect(await callCount(t.orgId)).toBe(0);
  });

  it('a weekend call waits for Monday', async () => {
    const { t, number } = await setup('cw2');
    // Saturday 2026-10-17, 10:00 in India.
    window.now = () => new Date('2026-10-17T04:30:00Z');
    const r = await dial(t, number.uuid);
    expect(r.body.code).toBe('CALL_OUTSIDE_WINDOW');
    expect(JSON.stringify(r.body)).toContain('2026-10-19T03:30:00.000Z');
  });

  it('inside the window the call goes on as before (here: no permission yet, so a request is sent)', async () => {
    const { t, number } = await setup('cw3');
    window.now = () => MIDDAY;
    const r = await dial(t, number.uuid);
    expect(r.body.code).toBe('CALL_PERMISSION_REQUESTED');
    expect(p.meta.messages()).toHaveLength(1);
  });

  it('with the calling window off (the default) any hour is fine', async () => {
    const { t, number } = await setup('cw4', { window: false });
    const r = await dial(t, number.uuid);
    expect(r.body.code).toBe('CALL_PERMISSION_REQUESTED');
  });

  it('a call back to someone who called in the last day is service: the window does not apply', async () => {
    const { t, number } = await setup('cw5');
    await p.api.seedContacts(t, [{ name: 'Asha Rao', phone: `+${CUSTOMER}` }]);
    await deliver(p, number, {
      id: `wacid.cw5.${Date.now()}`,
      event: 'connect',
      direction: 'USER_INITIATED',
      from: CUSTOMER,
      to: number.phone.replace(/\D/g, ''),
      timestamp: String(Math.floor(Date.now() / 1000)),
      session: { sdp_type: 'offer', sdp: SDP_OFFER },
    });
    p.meta.reset();
    const r = await dial(t, number.uuid);
    expect(r.body.code).not.toBe('CALL_OUTSIDE_WINDOW');
  });

  it("reads the window on the contact's clock: a contact in New York is inside at the same instant", async () => {
    const { t, number } = await setup('cw6');
    await p.api.seedContacts(t, [
      { name: 'Ned', phone: '+14155550123', data: { timezone: 'America/New_York' } },
    ]);
    // 16:00 UTC Thursday: 12:00 in New York, inside 09:00 to 17:00.
    const r = await dial(t, number.uuid, '14155550123');
    expect(r.body.code).not.toBe('CALL_OUTSIDE_WINDOW');
  });
});
