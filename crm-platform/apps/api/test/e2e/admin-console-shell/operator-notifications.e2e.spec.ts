import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { operatorNotificationsPageSchema, operatorNotificationsRecentSchema } from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/** WD-ASHELL-006: the console bell's platform feed, end to end against a real database. */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let superToken = '';
let supportToken = '';
let userToken = '';
const email = `feed${Date.now()}@example.test`;

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const code = hotp(base32Decode(setup.body.secret), totpStep(Date.now()));
  await api().post('/v2/platform/auth/mfa/enable').set(bearer(token)).send({ code });
  superToken = token;
  const sup = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;
  const signup = await api().post('/v2/auth/signup').set('x-forwarded-for', '10.9.0.2').send({
    orgName: 'Feed Org',
    fullName: 'Feed Person',
    email,
    password: 'Str0ngPassw0rd#1',
    acceptTerms: true,
  });
  expect(signup.status, JSON.stringify(signup.body)).toBe(201);
  userToken = signup.body.tokens.accessToken as string;
  await h.owner.query(
    `INSERT INTO contact_messages (name, email, topic, message) VALUES ('Casey', 'casey@example.test', 'Sales', 'hello')`,
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('platform notification feed', () => {
  it('needs an operator session: no token, and a customer token, are refused', async () => {
    expect((await api().get('/v2/platform/notifications/recent')).status).toBe(401);
    const asUser = await api().get('/v2/platform/notifications/recent').set(bearer(userToken));
    expect([401, 403]).toContain(asUser.status);
  });

  it('the bell lists new signups, workspaces and contact messages with an unread count', async () => {
    const res = await api().get('/v2/platform/notifications/recent').set(bearer(supportToken));
    expect(res.status).toBe(200);
    const body = operatorNotificationsRecentSchema.parse(res.body);
    const kinds = body.items.map((i) => i.titleKey);
    expect(kinds).toEqual(expect.arrayContaining(['signup', 'newWorkspace', 'newContactMessage']));
    const signup = body.items.find((i) => i.titleKey === 'signup' && i.message?.includes(email));
    expect(signup?.message).toBe(`Feed Person · ${email}`);
    expect(body.unread).toBeGreaterThanOrEqual(3);
    expect(body.items.length).toBeLessThanOrEqual(15);
  });

  it('mark all read moves only that operator marker: the other operator still has unread events', async () => {
    const read = await api().post('/v2/platform/notifications/read-all').set(bearer(supportToken));
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ unread: 0 });
    const mine = await api().get('/v2/platform/notifications/recent').set(bearer(supportToken));
    expect(mine.body.unread).toBe(0);
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(mine.body.items.some((i: { unread: boolean }) => i.unread)).toBe(false);
    const theirs = await api().get('/v2/platform/notifications/recent').set(bearer(superToken));
    expect(theirs.body.unread).toBeGreaterThan(0);
  });

  it('a new event after the marker is unread again', async () => {
    await new Promise((r) => setTimeout(r, 50));
    await h.owner.query(
      `INSERT INTO contact_messages (name, email, topic, message) VALUES ('Dana', 'dana@example.test', 'Press', 'hi')`,
    );
    const res = await api().get('/v2/platform/notifications/recent').set(bearer(supportToken));
    expect(res.body.unread).toBe(1);
    expect(res.body.items[0]).toMatchObject({ titleKey: 'newContactMessage', unread: true });
  });

  it('the page returns 30-day counts, narrows by type and by text, and rejects an unknown type', async () => {
    const all = await api().get('/v2/platform/notifications').set(bearer(superToken));
    expect(all.status).toBe(200);
    const page = operatorNotificationsPageSchema.parse(all.body);
    expect(page.stats.contact).toBe(2);
    expect(page.stats.workspace).toBeGreaterThanOrEqual(1);
    expect(page.stats.total).toBe(
      page.stats.signup +
        page.stats.payment +
        page.stats.ticket +
        page.stats.contact +
        page.stats.workspace,
    );

    const contacts = await api()
      .get('/v2/platform/notifications?type=contact')
      .set(bearer(superToken));
    expect(contacts.body.items.every((i: { type: string }) => i.type === 'contact')).toBe(true);
    expect(contacts.body.items).toHaveLength(2);

    const found = await api().get('/v2/platform/notifications?q=dana').set(bearer(superToken));
    expect(found.body.items).toHaveLength(1);

    const bad = await api().get('/v2/platform/notifications?type=nope').set(bearer(superToken));
    expect(bad.status).toBe(422);
  });

  it('opening the page marks everything seen, and clear all does the same', async () => {
    const after = await api().get('/v2/platform/notifications/recent').set(bearer(superToken));
    expect(after.body.unread).toBe(0);
    await h.owner.query(
      `INSERT INTO contact_messages (name, email, topic, message) VALUES ('Eli', 'eli@example.test', 'Jobs', 'yo')`,
    );
    expect(
      (await api().get('/v2/platform/notifications/recent').set(bearer(superToken))).body.unread,
    ).toBe(1);
    const cleared = await api().delete('/v2/platform/notifications').set(bearer(superToken));
    expect(cleared.status).toBe(200);
    expect(
      (await api().get('/v2/platform/notifications/recent').set(bearer(superToken))).body.unread,
    ).toBe(0);
  });
});
