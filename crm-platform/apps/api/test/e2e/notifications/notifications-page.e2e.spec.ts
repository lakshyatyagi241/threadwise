import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * What the full Notifications page (/notifications) needs beyond the bell: filter by type and text, the summary numbers, dismiss one,
 * clear all. Rows are arranged with the owner connection; everything asserted goes through HTTP, against real Postgres with forced RLS.
 */
let h: Harness;
let api: Api;
let t: Tenant;
let other: Tenant;
let mate: { token: string; userId: number };

const A = (token: string) => api.as(token);
const add = (
  orgId: number,
  userId: number,
  r: { type: string; title: string; body?: string; read?: boolean; ageHours?: number },
) =>
  h.owner.query(
    `INSERT INTO inbox_notifications (org_id, user_id, type, title, body, read_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() - ($7 || ' hours')::interval)`,
    [orgId, userId, r.type, r.title, r.body ?? null, r.read ? new Date() : null, String(r.ageHours ?? 0)],
  );

beforeAll(async () => {
  h = await startHarness({});
  api = new Api(h);
  t = await api.signup('notifpage');
  other = await api.signup('notifother');
  mate = await api.member(t, 'mate', [['inbox.conversation.read']]);
  await add(t.orgId, t.adminUserId, { type: 'task_assigned', title: 'Task: Call Sara', ageHours: 1 });
  await add(t.orgId, t.adminUserId, { type: 'task_due', title: 'Task due: 100% done?', body: 'Due today', read: true, ageHours: 30 });
  await add(t.orgId, t.adminUserId, { type: 'new_chat', title: 'New chat from Ali', ageHours: 24 * 10 });
  await add(t.orgId, t.adminUserId, { type: 'new_chat', title: 'New chat from Omar', read: true, ageHours: 24 * 12 });
  await add(t.orgId, mate.userId, { type: 'task_assigned', title: 'Mate only' });
  await add(other.orgId, other.adminUserId, { type: 'task_assigned', title: 'Other workspace' });
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

const list = async (token: string, q = '') => {
  const res = await A(token).get(`/v2/notifications${q}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { data: Array<{ id: string; type: string; title: string; readAt: string | null }>; meta: { unread: number } };
};

describe('filters', () => {
  it('by type', async () => {
    const r = await list(t.admin, '?type=new_chat');
    expect(r.data.map((n) => n.title).sort()).toEqual(['New chat from Ali', 'New chat from Omar']);
  });
  it('by text in the title or the body, case-insensitively', async () => {
    expect((await list(t.admin, '?q=SARA')).data.map((n) => n.title)).toEqual(['Task: Call Sara']);
    expect((await list(t.admin, '?q=due%20today')).data.map((n) => n.type)).toEqual(['task_due']);
  });
  it('wildcards in the text are literal', async () => {
    expect((await list(t.admin, '?q=%25')).data.map((n) => n.title)).toEqual(['Task due: 100% done?']);
    expect((await list(t.admin, '?q=_')).data).toEqual([]);
  });
  it('combines with unread only, and never shows another person or workspace', async () => {
    const r = await list(t.admin, '?type=new_chat&unreadOnly=true');
    expect(r.data.map((n) => n.title)).toEqual(['New chat from Ali']);
    const all = await list(t.admin);
    expect(all.data.some((n) => n.title === 'Mate only' || n.title === 'Other workspace')).toBe(false);
  });
});

describe('summary', () => {
  it('counts the caller own rows: unread, last day, last week, per type', async () => {
    const res = await A(t.admin).get('/v2/notifications/summary');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      unread: 2,
      last24Hours: 1,
      last7Days: 2,
      total: 4,
      byType: { task_assigned: 1, task_due: 1, new_chat: 2 },
    });
    expect((await A(mate.token).get('/v2/notifications/summary')).body.total).toBe(1);
  });
});

describe('dismiss and clear', () => {
  it('dismisses one of my own, 404 for someone else or unknown', async () => {
    const mine = (await list(t.admin, '?type=task_assigned')).data[0]!;
    const theirs = (await list(mate.token)).data[0]!;
    expect((await A(t.admin).delete(`/v2/notifications/${theirs.id}`)).status).toBe(404);
    expect((await A(t.admin).delete('/v2/notifications/3f0b9f0e-6c1c-4a39-9b7e-0d4d2b0c1a11')).status).toBe(404);
    const done = await A(t.admin).delete(`/v2/notifications/${mine.id}`);
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ deleted: 1 });
    expect((await list(t.admin, '?type=task_assigned')).data).toEqual([]);
    expect((await list(t.admin)).meta.unread).toBe(1); // the badge follows
    expect((await list(mate.token)).data).toHaveLength(1); // nobody else lost anything
  });

  it('clear all (the existing shell endpoint of the bell) clears only my rows', async () => {
    const res = await A(t.admin).delete('/v2/shell/notifications');
    expect(res.status).toBe(200);
    expect((await list(t.admin)).data).toEqual([]);
    expect((await list(mate.token)).data).toHaveLength(1);
    expect((await list(other.admin)).data).toHaveLength(1);
  });
});
