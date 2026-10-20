import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppointmentsApi, startHarness, type Harness } from '../appointments-booking/support';
import { race, statuses } from './support';

/**
 * QA Sheet3 #15, CC-LIM-06j: the monthly appointment cap. 8 bookings for 8 different slots at once on a plan of 3 a month: exactly 3
 * are booked, the rest are refused with PLAN_LIMIT_REACHED, and the public page answers "not available" for the same race.
 */
let h: Harness;
let api: AppointmentsApi;
beforeAll(async () => {
  h = await startHarness();
  api = new AppointmentsApi(h);
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

describe('CC-LIM-06j monthly appointment cap', () => {
  it('staff: 8 bookings at once on a cap of 3 a month book exactly 3', async () => {
    const t = await api.signup('apcc');
    const type = await api.type(t.admin, { name: 'Capped' });
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"appointments":3}}' WHERE org_id = $1`,
      [t.orgId],
    );
    const slots = await api.slots(t.admin, type.id);
    const res = await race(8, (i) =>
      api.post(t.admin, '/v2/appointments', {
        bookingTypeId: type.id,
        startsAt: slots[i]!.start,
        invitee: { name: `C${i}`, phone: `+91981110${String(1000 + i)}` },
      }),
    );
    for (const r of res.filter((x) => x.status !== 201)) {
      expect(r.status, JSON.stringify(r.body)).toBe(422);
      expect(r.body.code).toBe('PLAN_LIMIT_REACHED');
    }
    expect(
      res.filter((r) => r.status === 201),
      JSON.stringify(statuses(res)),
    ).toHaveLength(3);
    const n = Number(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM appointments WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    );
    expect(n).toBe(3);
  });

  it('public page: 8 visitors at once on a cap of 3 a month book exactly 3, the rest are told "not available"', async () => {
    const t = await api.signup('apcp');
    const type = await api.type(t.admin, { name: 'Capped public' });
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"appointments":3}}' WHERE org_id = $1`,
      [t.orgId],
    );
    const slots = await api.slots(t.admin, type.id);
    const res = await race(8, (i) =>
      api.publicBook(t.slug, type.slug, {
        startsAt: slots[i]!.start,
        name: `V${i}`,
        email: `v${i}-cap@example.com`,
      }),
    );
    for (const r of res.filter((x) => x.status !== 201)) {
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.code).toBe('APPT_BOOKING_UNAVAILABLE');
    }
    expect(
      res.filter((r) => r.status === 201),
      JSON.stringify(statuses(res)),
    ).toHaveLength(3);
  });
});
