import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';
import { maskPhone } from '../../../src/modules/crm/contacts/phone-mask';

/**
 * TW-AUTH-042 (Customer phone-number masking) — Reference's own toggle was dead code: the
 * display helper early-returned the number unchanged and the admin on/off switch was removed.
 * The port note says do not resurrect that global toggle; instead gate the real number behind an
 * RBAC field permission, `contacts.phone.reveal`: agents see it masked, admins/owners see it in
 * full. These tests prove the mask is enforced in the API RESPONSE BODY itself — the level that
 * actually matters, since a client-side-only mask would still leak the real number over the
 * network. They never call the mapper/mask function directly to check the result; they read what
 * supertest got back from the real HTTP route.
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

const RAW_PHONE = '+919145808988';
const MASKED_PHONE = maskPhone(RAW_PHONE);

describe('contacts.phone.reveal masks the phone number in the API response', () => {
  let t: Tenant;
  let withReveal: { token: string; userId: number };
  let withoutReveal: { token: string; userId: number };
  let contactId: string;

  beforeAll(async () => {
    t = await api.signup('pmask');
    withReveal = await api.member(t, 'reveal', [
      ['record.contacts.read', 'all'],
      ['record.contacts.create', 'all'],
      ['contacts.phone.reveal', 'all'],
    ]);
    withoutReveal = await api.member(t, 'masked', [
      ['record.contacts.read', 'all'],
      ['record.contacts.create', 'all'],
    ]);
    [contactId] = await api.seedContacts(t, [{ name: 'Masking Target', phone: RAW_PHONE }]);
  });

  it('sanity: the masked form is actually different from the raw number', () => {
    expect(MASKED_PHONE).not.toBe(RAW_PHONE);
    expect(MASKED_PHONE).toBe('+xxxxxxxx8988');
  });

  it('DETAIL: an actor without the permission gets the masked string in the response body, never the raw digits', async () => {
    const res = await api.as(withoutReveal.token).get(`/v2/contacts/${contactId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.phone).toBe(MASKED_PHONE);
    // the hard requirement: the raw number must not be anywhere in the body, not just absent from the `phone` field
    expect(JSON.stringify(res.body)).not.toContain('9145808988');
  });

  it('DETAIL: an actor WITH the permission gets the real number', async () => {
    const res = await api.as(withReveal.token).get(`/v2/contacts/${contactId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.phone).toBe(RAW_PHONE);
  });

  it('LIST: the same contact is masked for the caller without the permission and raw for the caller with it', async () => {
    const masked = await api.as(withoutReveal.token).get('/v2/contacts?limit=50');
    const row = (masked.body.data as Array<{ id: string; phone: string }>).find(
      (r) => r.id === contactId,
    );
    expect(row?.phone).toBe(MASKED_PHONE);
    expect(JSON.stringify(masked.body)).not.toContain('9145808988');

    const revealed = await api.as(withReveal.token).get('/v2/contacts?limit=50');
    const row2 = (revealed.body.data as Array<{ id: string; phone: string }>).find(
      (r) => r.id === contactId,
    );
    expect(row2?.phone).toBe(RAW_PHONE);
  });

  it('the org Owner sees the real number without ever being granted the key explicitly (the new-permission-defs trigger auto-grants Owner/Admin presets)', async () => {
    const res = await api.as(t.admin).get(`/v2/contacts/${contactId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.phone).toBe(RAW_PHONE);
  });

  it('CREATE: the response is masked for an actor without the permission too — the identity-match branch can hand back an EXISTING contact\'s number the caller never typed, so create goes through the same gate as list/detail rather than trusting "they already know it"', async () => {
    const created = await api
      .as(withoutReveal.token)
      .post('/v2/contacts')
      .send({ name: 'Self Typed', phone: '+919900011122' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.phone).toBe(maskPhone('+919900011122'));

    // and with the permission, the same create returns it raw
    const createdRevealed = await api
      .as(withReveal.token)
      .post('/v2/contacts')
      .send({ name: 'Self Typed 2', phone: '+919900011133' });
    expect(createdRevealed.status, JSON.stringify(createdRevealed.body)).toBe(201);
    expect(createdRevealed.body.phone).toBe('+919900011133');
  });

  it('a null phone is never "masked" into a non-null placeholder', async () => {
    const [noPhoneId] = await api.seedContacts(t, [{ name: 'No Phone', phone: null }]);
    const res = await api.as(withoutReveal.token).get(`/v2/contacts/${noPhoneId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.phone).toBeNull();
  });
});
