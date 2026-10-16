import { describe, expect, it } from 'vitest';
import {
  deriveMicrosoftKey,
  newState,
  returnUrl,
  signState,
  signTicket,
  STATE_TTL_SECONDS,
  verifyState,
  verifyTicket,
} from '../../../src/modules/appointments-booking/microsoft-calendar-state';
import {
  deriveStateKey,
  signState as signGoogleState,
  newState as newGoogleState,
} from '../../../src/modules/appointments-booking/google-calendar-state';

/** The signed tokens of the Microsoft consent round trip (BL-035). */
const credentialsKey = Buffer.alloc(32, 9).toString('base64');
const key = deriveMicrosoftKey(credentialsKey);
const NOW = 1_800_000_000_000;

describe('the state', () => {
  const state = newState({ orgId: 7, userId: 3, returnTo: '/appointments/settings' }, NOW);

  it('round-trips and names the workspace and the admin', () => {
    const checked = verifyState(signState(state, key), key, NOW + 1000);
    expect(checked).toEqual({ ok: true, value: state });
    expect(state.expiresAt).toBe(NOW + STATE_TTL_SECONDS * 1000);
  });

  it('expires', () => {
    expect(verifyState(signState(state, key), key, state.expiresAt)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses a changed payload, another key, and garbage', () => {
    const token = signState(state, key);
    const [payload, sig] = token.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), o: 8 }),
    ).toString('base64url');
    expect(verifyState(`${forged}.${sig}`, key, NOW)).toMatchObject({
      ok: false,
      reason: 'signature',
    });
    expect(
      verifyState(token, deriveMicrosoftKey(Buffer.alloc(32, 1).toString('base64')), NOW),
    ).toMatchObject({
      ok: false,
      reason: 'signature',
    });
    expect(verifyState('nonsense', key, NOW)).toMatchObject({ ok: false, reason: 'malformed' });
    expect(verifyState('', key, NOW)).toMatchObject({ ok: false });
  });

  it('a Google state is not a Microsoft state, and the other way round', () => {
    const g = signGoogleState(
      newGoogleState({ orgId: 7, userId: 3, returnTo: '/appointments/settings' }, NOW),
      deriveStateKey(credentialsKey),
    );
    expect(verifyState(g, key, NOW)).toMatchObject({ ok: false });
    expect(verifyState(signState(state, key), deriveStateKey(credentialsKey), NOW)).toMatchObject({
      ok: false,
    });
  });
});

describe('the ticket', () => {
  const ticket = {
    orgId: 7,
    userId: 3,
    returnTo: '/appointments/settings',
    sealedCode: 'sealed-code',
    expiresAt: NOW + 60_000,
  };

  it('round-trips', () => {
    expect(verifyTicket(signTicket(ticket, key), key, NOW)).toEqual({ ok: true, value: ticket });
  });

  it('is not a state, and a state is not a ticket', () => {
    const state = newState({ orgId: 7, userId: 3, returnTo: '/x' }, NOW);
    expect(verifyTicket(signState(state, key), key, NOW)).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyState(signTicket(ticket, key), key, NOW)).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
  });

  it('expires', () => {
    expect(verifyTicket(signTicket(ticket, key), key, ticket.expiresAt + 1)).toMatchObject({
      ok: false,
      reason: 'expired',
    });
  });
});

describe('returnUrl', () => {
  it('appends the outcome to a path inside the app', () => {
    expect(returnUrl('https://app.test/', '/appointments/settings', { calendar: 'denied' })).toBe(
      'https://app.test/appointments/settings?calendar=denied',
    );
    expect(returnUrl('https://app.test', '/a?x=1', { calendar: 'connected' })).toBe(
      'https://app.test/a?x=1&calendar=connected',
    );
  });

  it('never leaves the app, whatever the signed path says', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil', 'evil']) {
      expect(returnUrl('https://app.test', bad, { calendar: 'failed' })).toBe(
        'https://app.test/appointments/settings?calendar=failed',
      );
    }
  });

  it('encodes the ticket', () => {
    const url = returnUrl('https://app.test', '/p', {
      calendar: 'microsoft_confirm',
      ticket: 'a.b',
    });
    expect(new URL(url).searchParams.get('ticket')).toBe('a.b');
  });
});
