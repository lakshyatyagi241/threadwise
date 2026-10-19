import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, PASSWORD, startHarness, type Harness } from '../contacts-attributes-tags/support';
import { ROUNDS, race, statuses } from './support';

/**
 * QA Sheet3 #15, identity and record races: the same sign-up, the same reset link, the same login failing, two edits that collide on
 * a unique value, an edit against a delete, the same tag attached twice. None may answer 5xx or leave a duplicate or half-made row.
 * Scenarios: CC-AUTH-01..03, CC-DATA-01..03.
 */
let h: Harness;
let api: Api;
beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

let ip = 0;
const nextIp = () => `10.77.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
const http = () => request(h.app.getHttpServer());
const q = (text: string, params: unknown[] = []) => h.owner.query(text, params);
const scalar = async (text: string, params: unknown[] = []) =>
  Number((await q(text, params)).rows[0].n);

describe('CC-AUTH: sign-up, reset link, login failures', () => {
  it('CC-AUTH-01 the same e-mail signing up 6 times at once makes one workspace; the others are refused, none is a 5xx', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const email = `same${Date.now()}${round}@example.test`;
      const res = await race(6, (i) =>
        http()
          .post('/v2/auth/signup')
          .set('x-forwarded-for', nextIp())
          .send({ orgName: `Same ${round} ${i}`, fullName: 'Same Person', email, password: PASSWORD, acceptTerms: true }),
      );
      for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
      expect(res.filter((r) => r.status === 201), JSON.stringify(statuses(res))).toHaveLength(1);
      expect(await scalar(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [email])).toBe(1);
      // No workspace is left behind by a refused sign-up.
      expect(
        await scalar(`SELECT count(*)::int AS n FROM organizations WHERE name LIKE $1`, [`Same ${round} %`]),
      ).toBe(1);
    }
  });

  it('CC-AUTH-02 one reset link used 5 times at once (5 different new passwords): one wins and only that password signs in', async () => {
    const t = await api.signup('rst');
    const user = (await q(`SELECT email FROM users WHERE id = $1`, [t.adminUserId])).rows[0].email as string;
    await q(`UPDATE user_security SET email_verified_at = now() WHERE org_id = $1`, [t.orgId]);
    await http().post('/v2/auth/forgot-password').set('x-forwarded-for', nextIp()).send({ orgSlug: t.slug, email: user });
    let token = '';
    for (let i = 0; i < 60 && !token; i++) {
      const m = h.mail.find((x) => x.to === user && /reset-password/.test(x.text));
      if (m) token = new URL(/https?:\/\/\S+reset-password\?\S+/.exec(m.text)![0]).searchParams.get('token')!;
      else await new Promise((r) => setTimeout(r, 100));
    }
    expect(token).not.toBe('');
    const passwords = Array.from({ length: 5 }, (_, i) => `Fresh#Passw0rd-${i}-xyz`);
    const res = await race(5, (i) =>
      http().post('/v2/auth/reset-password').set('x-forwarded-for', nextIp()).send({ orgSlug: t.slug, token, password: passwords[i] }),
    );
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    const won = res.map((r, i) => (r.status < 300 ? i : -1)).filter((i) => i >= 0);
    expect(won, JSON.stringify(statuses(res))).toHaveLength(1);
    const logins = await Promise.all(
      passwords.map((pw) =>
        http().post('/v2/auth/login').set('x-forwarded-for', nextIp()).send({ orgSlug: t.slug, email: user, password: pw }),
      ),
    );
    expect(logins.map((l) => l.status < 300)).toEqual(passwords.map((_, i) => i === won[0]));
  });

  it('CC-AUTH-03 12 wrong passwords at once are all refused (401 or 429), the failure counter never errors', async () => {
    const t = await api.signup('lck');
    const user = (await q(`SELECT email FROM users WHERE id = $1`, [t.adminUserId])).rows[0].email as string;
    const res = await race(12, () =>
      http().post('/v2/auth/login').set('x-forwarded-for', nextIp()).send({ orgSlug: t.slug, email: user, password: 'Wrong#Passw0rd-1' }),
    );
    for (const r of res) expect([401, 423, 429], JSON.stringify(r.body)).toContain(r.status);
  });
});

describe('CC-DATA: edits that collide', () => {
  it('CC-DATA-01 two contacts edited to the same e-mail at once: no 5xx, each answers like a lone edit would (200), both rows readable', async () => {
    // Sequentially a contact may be edited to an e-mail another contact holds (200), so "one wins" is not a rule; the rule is that the
    // race is no worse than the lone edit: no 5xx, no half-written row.
    const t = await api.signup('dat1');
    const a = await api.as(t.admin).post('/v2/contacts').send({ name: 'A', email: 'a-dat1@example.com' });
    const b = await api.as(t.admin).post('/v2/contacts').send({ name: 'B', email: 'b-dat1@example.com' });
    const res = await race(2, (i) =>
      api.as(t.admin).patch(`/v2/contacts/${(i === 0 ? a : b).body.id}`).send({ email: 'shared-dat1@example.com', rowVersion: 1 }),
    );
    for (const r of res) expect([200, 409, 422], JSON.stringify(r.body)).toContain(r.status);
    for (const c of [a, b]) {
      const got = await api.as(t.admin).get(`/v2/contacts/${c.body.id}`);
      expect(got.status).toBe(200);
      expect(['shared-dat1@example.com', c.body.email]).toContain(got.body.email);
    }
  });

  it('CC-DATA-02 an edit and a delete of one contact at once: each answers 2xx or 404/409, never a 5xx, and the row is gone or edited, not half of each', async () => {
    const t = await api.signup('dat2');
    for (let round = 0; round < ROUNDS; round++) {
      const c = await api.as(t.admin).post('/v2/contacts').send({ name: `C${round}`, email: `c${round}-dat2@example.com` });
      const res = await race(2, (i) =>
        i === 0
          ? api.as(t.admin).patch(`/v2/contacts/${c.body.id}`).send({ name: 'Edited', rowVersion: 1 })
          : api.as(t.admin).delete(`/v2/contacts/${c.body.id}`),
      );
      for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
      const left = (await q(`SELECT name FROM contacts WHERE uuid = $1`, [c.body.id])).rows;
      if (res[1]!.status < 300) expect(left).toHaveLength(0);
      else expect(left).toHaveLength(1);
    }
  });

  it('CC-DATA-03 the same new tag name attached to one contact 8 times at once: one tag, one link, no 5xx', async () => {
    const t = await api.signup('dat3');
    const c = await api.as(t.admin).post('/v2/contacts').send({ name: 'Tagged', email: 'tagged-dat3@example.com' });
    const res = await race(8, () => api.as(t.admin).post(`/v2/contacts/${c.body.id}/tags`).send({ name: 'vip-dat3' }));
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    expect(await scalar(`SELECT count(*)::int AS n FROM tags WHERE org_id = $1 AND name = 'vip-dat3'`, [t.orgId])).toBe(1);
    expect(
      await scalar(`SELECT count(*)::int AS n FROM contact_tags ct JOIN tags g ON g.id = ct.tag_id AND g.org_id = ct.org_id WHERE ct.org_id = $1 AND g.name = 'vip-dat3'`, [t.orgId]),
    ).toBe(1);
  });
});
