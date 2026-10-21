import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * The settings a team keeps for handoff and assignment (BL-396): opening hours, their time zone and the default assignee, now editable
 * through the Teams endpoints (they were stored columns nothing could set). Real Postgres, through HTTP.
 */
let h: Harness;
let api: Api;
let t: Tenant;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('tmhs');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

interface Team {
  id: string;
  rowVersion: number;
  unusedSettings: {
    businessHours: { days: Record<string, { enabled: boolean; from: string; to: string }> } | null;
    timezone: string | null;
    defaultAssignee: { id: string; fullName: string } | null;
  };
}

const uuidOf = async (userId: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

const week = (from: string, to: string) =>
  Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [
      k,
      { enabled: k !== 'sat' && k !== 'sun', from, to },
    ]),
  );

describe('team handoff settings', () => {
  it('creates a team with hours, a time zone and a default assignee who is on it, and returns them', async () => {
    const ana = await api.member(t, 'Ana', [['team.read']]);
    const anaUuid = await uuidOf(ana.userId);
    const res = await api.as(t.admin).post('/v2/workspace/teams').send({
      name: 'Support',
      memberIds: [anaUuid],
      assignmentStrategy: 'round_robin',
      defaultAssigneeId: anaUuid,
      timezone: 'Asia/Kolkata',
      businessHours: { days: week('09:00', '18:00') },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const team = res.body as Team;
    expect(team.unusedSettings.timezone).toBe('Asia/Kolkata');
    expect(team.unusedSettings.defaultAssignee?.id).toBe(anaUuid);
    expect(team.unusedSettings.businessHours?.days.mon).toEqual({
      enabled: true,
      from: '09:00',
      to: '18:00',
    });
    // The handoff reads exactly these columns.
    const row = (
      await h.owner.query(
        `SELECT business_hours, timezone, default_assignee_id, assignment_strategy FROM teams WHERE uuid = $1`,
        [team.id],
      )
    ).rows[0];
    expect(row.timezone).toBe('Asia/Kolkata');
    expect(row.assignment_strategy).toBe('round_robin');
    expect(row.default_assignee_id).toBe(String(ana.userId));
    expect(row.business_hours.days.fri.to).toBe('18:00');
  });

  it('a default assignee who is not on the team is refused with 422 WSP_TEAM_MEMBER_UNKNOWN', async () => {
    const ben = await api.member(t, 'Ben', [['team.read']]);
    const benUuid = await uuidOf(ben.userId);
    const res = await api
      .as(t.admin)
      .post('/v2/workspace/teams')
      .send({ name: 'Billing', memberIds: [], defaultAssigneeId: benUuid });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('WSP_TEAM_MEMBER_UNKNOWN');
  });

  it('updates and clears the settings: null removes the hours, the time zone and the default assignee', async () => {
    const cy = await api.member(t, 'Cy', [['team.read']]);
    const cyUuid = await uuidOf(cy.userId);
    const made = await api
      .as(t.admin)
      .post('/v2/workspace/teams')
      .send({ name: 'Sales', memberIds: [cyUuid] });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const team = made.body as Team;
    expect(team.unusedSettings).toMatchObject({
      businessHours: null,
      timezone: null,
      defaultAssignee: null,
    });

    const set = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${team.id}`)
      .send({
        rowVersion: team.rowVersion,
        defaultAssigneeId: cyUuid,
        timezone: 'Europe/London',
        businessHours: { days: week('08:00', '16:00') },
      });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const after = set.body as Team;
    expect(after.unusedSettings.defaultAssignee?.id).toBe(cyUuid);
    expect(after.unusedSettings.timezone).toBe('Europe/London');
    expect(after.unusedSettings.businessHours?.days.tue.from).toBe('08:00');

    const cleared = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${team.id}`)
      .send({
        rowVersion: after.rowVersion,
        defaultAssigneeId: null,
        timezone: null,
        businessHours: null,
      });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect((cleared.body as Team).unusedSettings).toMatchObject({
      businessHours: null,
      timezone: null,
      defaultAssignee: null,
    });
  });

  it('refuses a time zone that does not exist and hours with a closing time equal to the opening time', async () => {
    const made = await api.as(t.admin).post('/v2/workspace/teams').send({ name: 'Ops' });
    const team = made.body as Team;
    const badZone = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${team.id}`)
      .send({ rowVersion: team.rowVersion, timezone: 'Mars/Olympus' });
    expect([400, 422]).toContain(badZone.status);
    const sameTimes = await api
      .as(t.admin)
      .patch(`/v2/workspace/teams/${team.id}`)
      .send({ rowVersion: team.rowVersion, businessHours: { days: week('09:00', '09:00') } });
    expect([400, 422]).toContain(sameTimes.status);
  });
});
