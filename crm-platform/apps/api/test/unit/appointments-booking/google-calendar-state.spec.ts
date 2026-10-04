import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deriveStateKey,
  newState,
  returnUrl,
  signState,
  STATE_TTL_SECONDS,
  verifyState,
} from '../../../src/modules/appointments-booking/google-calendar-state';

/**
 * The OAuth `state` of the Google consent round trip (TW-APPT-028): signed, bound to a workspace and an admin, short-lived. The
 * callback is public, so this check is the only thing between an arbitrary request and a stored grant.
 */
const KEY = deriveStateKey(Buffer.alloc(32, 7).toString('base64'));
const OTHER = deriveStateKey(Buffer.alloc(32, 8).toString('base64'));
const NOW = Date.parse('2026-10-05T10:00:00Z');
const make = () => newState({ orgId: 42, userId: 7, returnTo: '/appointments/settings' }, NOW);

describe('signing and verifying the state', () => {
  it('round-trips the workspace, the admin and the return path', () => {
    const state = make();
    const checked = verifyState(signState(state, KEY), KEY, NOW + 1000);
    expect(checked).toEqual({ ok: true, state });
    expect(checked.ok && checked.state.orgId).toBe(42);
    expect(checked.ok && checked.state.userId).toBe(7);
  });

  it('is good for ten minutes and not a second longer', () => {
    expect(STATE_TTL_SECONDS).toBe(600);
    const token = signState(make(), KEY);
    expect(verifyState(token, KEY, NOW + 599_000).ok).toBe(true);
    expect(verifyState(token, KEY, NOW + 600_000)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyState(token, KEY, NOW + 3_600_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a state signed with another key', () => {
    expect(verifyState(signState(make(), OTHER), KEY, NOW)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('refuses a payload edited after signing (a workspace swapped for another)', () => {
    const token = signState(make(), KEY);
    const [payload, mac] = token.split('.') as [string, string];
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { o: number };
    body.o = 99;
    const forged = `${Buffer.from(JSON.stringify(body)).toString('base64url')}.${mac}`;
    expect(verifyState(forged, KEY, NOW)).toEqual({ ok: false, reason: 'signature' });
  });

  it('refuses a truncated or empty signature and plain junk', () => {
    const token = signState(make(), KEY);
    expect(verifyState(token.slice(0, -4), KEY, NOW).ok).toBe(false);
    expect(verifyState(`${token.split('.')[0]}.`, KEY, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    for (const junk of ['', 'abc', 'a.b.c', '.', 'x.y']) {
      expect(verifyState(junk, KEY, NOW).ok, junk).toBe(false);
    }
  });

  it('does not accept a state whose purpose is not this one, even correctly signed with the key', () => {
    const payload = Buffer.from(
      JSON.stringify({ p: 'something.else', o: 1, u: 1, r: '/', n: 'n', e: NOW + 10_000 }),
    ).toString('base64url');
    const mac = createHmac('sha256', KEY).update(payload).digest('base64url');
    expect(verifyState(`${payload}.${mac}`, KEY, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('every state carries its own nonce', () => {
    expect(make().nonce).not.toBe(make().nonce);
    expect(signState(make(), KEY)).not.toBe(signState(make(), KEY));
  });

  it('keeps a missing admin (a system-started connection) as null', () => {
    const state = newState({ orgId: 1, userId: null, returnTo: '/x' }, NOW);
    const checked = verifyState(signState(state, KEY), KEY, NOW);
    expect(checked.ok && checked.state.userId).toBeNull();
  });
});

describe('where the browser lands after Google', () => {
  it('adds the outcome to a path inside the app', () => {
    expect(returnUrl('https://app.test', '/appointments/settings', 'connected')).toBe(
      'https://app.test/appointments/settings?calendar=connected',
    );
    expect(returnUrl('https://app.test/', '/a?tab=1', 'failed')).toBe(
      'https://app.test/a?tab=1&calendar=failed',
    );
  });

  it('never leaves the app: anything that is not a plain path goes to the settings screen', () => {
    for (const bad of ['//evil.test/x', 'https://evil.test', 'javascript:alert(1)', '\\evil', '']) {
      expect(returnUrl('https://app.test', bad, 'connected'), bad).toBe(
        'https://app.test/appointments/settings?calendar=connected',
      );
    }
  });
});
