import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Cancel, resume, send now, resend, delete and export (WD-CAMP-016, 017, 018, 020): the real app and a real Postgres. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

let n = 0;
const phone = () => `+91960${String(n++).padStart(7, '0')}`;
const post = (t: Tenant, path: string, body: object = {}) =>
  api
    .http()
    .post(`/v2/campaigns${path}`)
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body);
const del = (t: Tenant, id: string) =>
  api
    .http()
    .delete(`/v2/campaigns/${id}`)
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID());
const code = (res: { body: { code?: string; error?: { code?: string } } }) =>
  res.body.code ?? res.body.error?.code;

/** A campaign straight into the table with `n` recipients; `statuses` sets how each recipient is. */
async function campaign(
  t: Tenant,
  o: {
    status?: string;
    scheduleType?: string;
    statuses?: string[];
    name?: string;
    timezone?: string;
  } = {},
) {
  const statuses = o.statuses ?? ['queued'];
  const camp = (
    await h.owner.query(
      `INSERT INTO wpcampaigns (org_id, campaign_name, campaign_type, status, schedule_type, timezone, total_recipients, completed_at)
       VALUES ($1,$2,'text',$3,$4,$5,$6, CASE WHEN $3 IN ('completed','failed','cancelled') THEN now() END)
       RETURNING id, uuid`,
      [
        t.orgId,
        o.name ?? 'C',
        o.status ?? 'running',
        o.scheduleType ?? 'now',
        o.timezone ?? 'UTC',
        statuses.length,
      ],
    )
  ).rows[0];
  const contactUuids = await api.seedContacts(
    t,
    statuses.map((_, i) => ({ name: `Person ${n}-${i}`, phone: phone() })),
  );
  const contactIds: number[] = [];
  for (const [i, status] of statuses.entries()) {
    const c = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contactUuids[i]])).rows[0]
        .id,
    );
    contactIds.push(c);
    await h.owner.query(
      `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, whatsapp_message_id, sent_at, error_message, send_attempts)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $4 IN ('sent','delivered','read','responded') THEN now() END,
               CASE WHEN $4 = 'failed' THEN 'boom' END, CASE WHEN $4 = 'failed' THEN 3 ELSE 0 END)`,
      [
        t.orgId,
        camp.id,
        c,
        status,
        status === 'queued' ? null : `wamid.${randomUUID().slice(0, 6)}`,
      ],
    );
  }
  return { id: Number(camp.id), uuid: camp.uuid as string, contactUuids, contactIds };
}
const statusOf = async (uuid: string) =>
  (
    await h.owner.query(
      `SELECT status, completed_at, to_char(send_date, 'YYYY-MM-DD') AS send_date, send_time, sent_count, failed_count FROM wpcampaigns WHERE uuid = $1`,
      [uuid],
    )
  ).rows[0];
const rowsOf = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, whatsapp_message_id, error_message, send_attempts FROM wp_campaign_contacts WHERE campaign_id = $1 ORDER BY id`,
      [id],
    )
  ).rows as Array<{
    status: string;
    whatsapp_message_id: string | null;
    error_message: string | null;
    send_attempts: number;
  }>;

describe('WD-CAMP-016: cancel, resume, send now', () => {
  it('cancel stops a running campaign and resume starts it again', async () => {
    const t = await api.signup('ca1');
    const c = await campaign(t);
    const cancelled = await post(t, `/${c.uuid}/cancel`);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body).toEqual({
      id: c.uuid,
      status: 'cancelled',
      message: 'Campaign cancelled.',
    });
    expect((await statusOf(c.uuid)).status).toBe('cancelled');

    const resumed = await post(t, `/${c.uuid}/resume`);
    expect(resumed.body).toEqual({ id: c.uuid, status: 'running', message: 'Campaign resumed.' });
    expect((await statusOf(c.uuid)).status).toBe('running');
  });

  it('send now makes a scheduled campaign running with the date and time of now in its zone', async () => {
    const t = await api.signup('ca2');
    const c = await campaign(t, {
      status: 'scheduled',
      scheduleType: 'scheduled',
      timezone: 'Asia/Kolkata',
    });
    const res = await post(t, `/${c.uuid}/send-now`);
    expect(res.body).toMatchObject({ status: 'running', message: 'Campaign is sending now.' });
    const row = await statusOf(c.uuid);
    expect(row.status).toBe('running');
    const ist = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    expect(
      String(
        row.send_date instanceof Date ? row.send_date.toISOString().slice(0, 10) : row.send_date,
      ).slice(0, 10),
    ).toBe(ist);
  });

  it("another workspace's campaign is not found for every action", async () => {
    const t = await api.signup('ca3');
    const u = await api.signup('ca3b');
    const c = await campaign(u);
    for (const path of ['cancel', 'resume', 'send-now', 'resend']) {
      expect((await post(t, `/${c.uuid}/${path}`)).status).toBe(404);
    }
    expect((await del(t, c.uuid)).status).toBe(404);
    expect(
      (await api.http().get(`/v2/campaigns/${c.uuid}/export`).set(bearer(t.admin))).status,
    ).toBe(404);
  });
});

describe('WD-CAMP-017: resend', () => {
  it('failed scope resets only the failed rows, keeps the others, recomputes the counters and runs now', async () => {
    const t = await api.signup('ca4');
    const c = await campaign(t, {
      status: 'completed',
      statuses: ['delivered', 'failed', 'failed', 'sent'],
    });
    const res = await post(t, `/${c.uuid}/resend`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      status: 'running',
      scope: 'failed',
      recipients: 2,
      message: 'Resending to 2 failed recipients.',
    });
    const rows = await rowsOf(c.id);
    expect(rows.map((r) => r.status)).toEqual(['delivered', 'queued', 'queued', 'sent']);
    expect(rows[1]).toMatchObject({
      whatsapp_message_id: null,
      error_message: null,
      send_attempts: 0,
    });
    expect(rows[0]!.whatsapp_message_id).not.toBeNull();
    const camp = await statusOf(c.uuid);
    expect(camp).toMatchObject({
      status: 'running',
      completed_at: null,
      sent_count: 2,
      failed_count: 0,
    });
  });

  it('all scope resets everyone; selected resets only the contacts named; a scheduled campaign goes back to the schedule', async () => {
    const t = await api.signup('ca5');
    const all = await campaign(t, { status: 'failed', statuses: ['sent', 'failed'] });
    const a = await post(t, `/${all.uuid}/resend`, { scope: 'all' });
    expect(a.body).toMatchObject({ recipients: 2, message: 'Resending to all 2 recipients.' });
    expect((await rowsOf(all.id)).map((r) => r.status)).toEqual(['queued', 'queued']);

    const sel = await campaign(t, { status: 'completed', statuses: ['sent', 'sent', 'sent'] });
    const s = await post(t, `/${sel.uuid}/resend`, {
      scope: 'selected',
      contactIds: [sel.contactUuids[1]],
    });
    expect(s.body).toMatchObject({ recipients: 1, message: 'Resending to 1 selected recipient.' });
    expect((await rowsOf(sel.id)).map((r) => r.status)).toEqual(['sent', 'queued', 'sent']);

    const later = await campaign(t, {
      status: 'completed',
      scheduleType: 'scheduled',
      statuses: ['failed'],
    });
    const l = await post(t, `/${later.uuid}/resend`, {});
    expect(l.body.status).toBe('scheduled');
    expect((await statusOf(later.uuid)).status).toBe('scheduled');
  });

  it('refuses a running campaign, nobody to resend to, and a selection with nobody picked', async () => {
    const t = await api.signup('ca6');
    const running = await campaign(t, { status: 'running', statuses: ['failed'] });
    const r1 = await post(t, `/${running.uuid}/resend`, {});
    expect(r1.status).toBe(422);
    expect(code(r1)).toBe('CAMP_NOT_RESENDABLE');

    const clean = await campaign(t, { status: 'completed', statuses: ['sent'] });
    const r2 = await post(t, `/${clean.uuid}/resend`, {});
    expect(r2.status).toBe(422);
    expect(code(r2)).toBe('CAMP_NOTHING_TO_RESEND');
    expect(r2.body.detail ?? r2.body.message).toContain('no failed recipients');

    const r3 = await post(t, `/${clean.uuid}/resend`, { scope: 'selected' });
    expect(r3.status).toBe(422);
    const r4 = await post(t, `/${clean.uuid}/resend`, {
      scope: 'selected',
      contactIds: [randomUUID()],
    });
    expect(code(r4)).toBe('CAMP_NOTHING_TO_RESEND');
    // Nothing was touched by the refusals.
    expect((await rowsOf(clean.id)).map((r) => r.status)).toEqual(['sent']);
  });
});

describe('WD-CAMP-018: delete', () => {
  it('deletes a campaign in any status with its recipients; bulk delete keeps to this workspace', async () => {
    const t = await api.signup('ca7');
    const u = await api.signup('ca7b');
    const one = await campaign(t, { status: 'running', statuses: ['queued', 'queued'] });
    const gone = await del(t, one.uuid);
    expect(gone.status).toBe(204);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM wp_campaign_contacts WHERE campaign_id = $1`,
          [one.id],
        )
      ).rows[0].n,
    ).toBe(0);

    const a = await campaign(t);
    const b = await campaign(t);
    const foreign = await campaign(u);
    const bulk = await post(t, '/bulk-delete', { ids: [a.uuid, b.uuid, foreign.uuid] });
    expect(bulk.status, JSON.stringify(bulk.body)).toBe(200);
    expect(bulk.body.message).toBe('Deleted 2 campaigns.');
    expect([...bulk.body.ids].sort()).toEqual([a.uuid, b.uuid].sort());
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM wpcampaigns WHERE uuid = $1`, [
          foreign.uuid,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('WD-CAMP-020: export', () => {
  it('streams every recipient with names, phones, status and times, and neutralises formulas', async () => {
    const t = await api.signup('ca8');
    const c = await campaign(t, { status: 'completed', statuses: ['read', 'failed'] });
    await h.owner.query(`UPDATE contacts SET name = '=HYPERLINK("x")' WHERE id = $1`, [
      c.contactIds[0],
    ]);
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET delivered_at = now(), read_at = now(), variant = 'A', clicked = true, clicked_at = now()
       WHERE campaign_id = $1 AND contact_id = $2`,
      [c.id, c.contactIds[0]],
    );
    const res = await api.http().get(`/v2/campaigns/${c.uuid}/export`).set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="campaign-.*-recipients-\d{8}-\d{6}\.csv"/,
    );
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Recipient,Phone,Variant,Status,Clicked,Queued,Sent,Delivered,Read,Responded,Last event,Error',
    );
    expect(lines).toHaveLength(3);
    // Newest first: the failed recipient, then the read one with its formula name quoted away.
    expect(lines[1]).toContain(',Failed,No,');
    expect(lines[1]!.endsWith(',Queued,boom')).toBe(true);
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[2]).toContain(',A,Read,Yes,');
    expect(lines[2]).toContain(',Button tap,');
  });
});

describe('permissions', () => {
  it('each action needs its own key', async () => {
    const t = await api.signup('ca9');
    const c = await campaign(t, { status: 'completed', statuses: ['failed'] });
    const reader = await api.member(t, 'reader', [['camp.campaigns.read']]);
    const call = (method: 'post' | 'delete' | 'get', path: string, token: string) =>
      api
        .http()
        [method](`/v2/campaigns/${c.uuid}${path}`)
        .set(bearer(token))
        .set('idempotency-key', randomUUID())
        .send({});
    expect((await call('post', '/cancel', reader.token)).status).toBe(403);
    expect((await call('post', '/resend', reader.token)).status).toBe(403);
    expect((await call('get', '/export', reader.token)).status).toBe(403);
    expect((await call('delete', '', reader.token)).status).toBe(403);
    const control = await api.member(t, 'control', [['camp.campaigns.control']]);
    expect((await call('post', '/resend', control.token)).status).toBe(200);
  });
});
