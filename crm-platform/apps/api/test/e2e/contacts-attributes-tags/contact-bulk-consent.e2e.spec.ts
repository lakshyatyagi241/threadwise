import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * Marketing consent for one channel on a selection (the bulk consent action). It writes what the single consent edit writes, through the
 * same path: one ledger event per contact, the channel's state, the audit row, and the subscription label on a grant. The route needs the
 * consent right, and a grant needs the note of how the contacts agreed.
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

const phone = (i: number) => `+9190${String(20_000_000 + i)}`;

describe('bulk marketing consent for one channel', () => {
  let t: Tenant;
  let ids: string[];
  let writer: { token: string; userId: number };
  let reader: { token: string; userId: number };

  const state = async (uuid: string, channel: string) => {
    const res = await api.as(t.admin).get(`/v2/contact-consent/contacts/${uuid}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (
      (res.body.states as Array<{ channel: string; purpose: string; state: string }>).find(
        (s) => s.channel === channel && s.purpose === 'marketing',
      )?.state ?? 'unknown'
    );
  };

  beforeAll(async () => {
    t = await api.signup('bcs');
    ids = await api.seedContacts(
      t,
      [0, 1, 2].map((i) => ({
        name: `Consent ${i}`,
        phone: phone(i),
        email: `c${i}@example.test`,
      })),
    );
    writer = await api.member(t, 'writer', [
      ['record.contacts.update', 'all'],
      ['contacts.consent.manage', 'all'],
    ]);
    reader = await api.member(t, 'reader', [['record.contacts.update', 'all']]);
  });

  it('a grant with its note subscribes the selected contacts on that channel only, one event each', async () => {
    const res = await api
      .as(writer.token)
      .post('/v2/contacts/bulk/consent')
      .send({ ids: ids.slice(0, 2), channel: 'sms', action: 'granted', note: 'Ticked the form' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 2, changed: 2, failedCount: 0 });
    expect(res.body.succeeded).toEqual(ids.slice(0, 2));

    expect(await state(ids[0]!, 'sms')).toBe('granted');
    expect(await state(ids[1]!, 'sms')).toBe('granted');
    expect(await state(ids[2]!, 'sms')).toBe('unknown');
    expect(await state(ids[0]!, 'email')).toBe('unknown');

    const events = (await api.as(t.admin).get(`/v2/contact-consent/contacts/${ids[0]}`)).body
      .events as Array<{ channel: string; action: string; source: string; note: string | null }>;
    expect(events).toContainEqual(
      expect.objectContaining({
        channel: 'sms',
        action: 'granted',
        source: 'manual',
        note: 'Ticked the form',
      }),
    );
  });

  it('a withdrawal needs no note and moves the channel state back', async () => {
    const res = await api
      .as(writer.token)
      .post('/v2/contacts/bulk/consent')
      .send({ ids: [ids[0]], channel: 'sms', action: 'withdrawn' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 1, changed: 1 });
    expect(await state(ids[0]!, 'sms')).toBe('withdrawn');
  });

  it('a grant without a note is refused before anything is written', async () => {
    const res = await api
      .as(writer.token)
      .post('/v2/contacts/bulk/consent')
      .send({ ids: [ids[2]], channel: 'sms', action: 'granted' });
    expect(res.status).toBe(422);
    expect(await state(ids[2]!, 'sms')).toBe('unknown');
  });

  it('a selection by filter applies to every matching contact in the caller scope', async () => {
    const res = await api
      .as(writer.token)
      .post('/v2/contacts/bulk/consent')
      .send({
        filter: { q: 'Consent' },
        channel: 'email',
        action: 'withdrawn',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.matched).toBeGreaterThanOrEqual(3);
    expect(res.body.failedCount).toBe(0);
    expect(await state(ids[1]!, 'email')).toBe('withdrawn');
  });

  it('needs the consent right: someone who may edit contacts but not manage consent is refused', async () => {
    const res = await api
      .as(reader.token)
      .post('/v2/contacts/bulk/consent')
      .send({ ids: [ids[2]], channel: 'sms', action: 'withdrawn' });
    expect(res.status).toBe(403);
    expect(await state(ids[2]!, 'sms')).toBe('unknown');
  });

  it('a repeat of the same request under one Idempotency-Key is replayed, not recorded again', async () => {
    const body = { ids: [ids[1]], channel: 'telegram', action: 'withdrawn' };
    const key = `bulk-consent-${Date.now()}`;
    const first = await api
      .as(writer.token)
      .post('/v2/contacts/bulk/consent')
      .set('idempotency-key', key)
      .send(body);
    const again = await api
      .as(writer.token)
      .post('/v2/contacts/bulk/consent')
      .set('idempotency-key', key)
      .send(body);
    expect(first.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(first.body.changed).toBe(1);
  });
});
