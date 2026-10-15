import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deriveStateKey,
  newState,
  returnUrl,
  signState,
  STATE_TTL_SECONDS,
  verifyState,
} from '../../../src/modules/channel-email/mail-state';
import {
  deriveStateKey as calendarKey,
  newState as calendarNew,
  signState as calendarSign,
} from '../../../src/modules/appointments-booking/google-calendar-state';

const KEY_B64 = Buffer.alloc(32, 9).toString('base64');
const key = deriveStateKey(KEY_B64);
const NOW = 1_800_000_000_000;

describe('TW-MAIL-020: the signed OAuth state', () => {
  it('round-trips the workspace, the admin, the return page and the mailbox being reconnected', () => {
    const s = newState({ orgId: 7, userId: 3, returnTo: '/email', mailboxId: 'mb-1' }, NOW);
    const out = verifyState(signState(s, key), key, NOW + 1_000);
    expect(out).toEqual({ ok: true, state: s });
    expect(s.expiresAt).toBe(NOW + STATE_TTL_SECONDS * 1000);
    expect(newState({ orgId: 1, userId: null, returnTo: '/email' }, NOW).mailboxId).toBeNull();
  });

  it('refuses an expired, tampered, malformed or foreign-key state', () => {
    const token = signState(newState({ orgId: 7, userId: 3, returnTo: '/email' }, NOW), key);
    expect(verifyState(token, key, NOW + STATE_TTL_SECONDS * 1000 + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
    const [payload, sig] = token.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), o: 8 }),
    ).toString('base64url');
    expect(verifyState(`${forged}.${sig}`, key, NOW)).toEqual({ ok: false, reason: 'signature' });
    expect(verifyState(token, deriveStateKey(Buffer.alloc(32, 1).toString('base64')), NOW)).toEqual(
      { ok: false, reason: 'signature' },
    );
    expect(verifyState('nope', key, NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyState('', key, NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyState('a.b.c', key, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('a validly signed payload of another shape or purpose is refused', () => {
    const sign = (body: object) => {
      const p = Buffer.from(JSON.stringify(body)).toString('base64url');
      return `${p}.${createHmac('sha256', key).update(p).digest().toString('base64url')}`;
    };
    expect(
      verifyState(
        sign({ p: 'something.else', o: 1, u: 1, r: '/email', m: null, n: 'n', e: NOW + 5 }),
        key,
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'malformed' });
    expect(
      verifyState(
        sign({
          p: 'email.google-mail.connect',
          o: '1',
          u: 1,
          r: '/email',
          m: null,
          n: 'n',
          e: NOW + 5,
        }),
        key,
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  it('a Google Calendar state does not verify here (own key and own purpose), and the other way round', () => {
    const cal = calendarSign(
      calendarNew({ orgId: 7, userId: 3, returnTo: '/appointments/settings' }, NOW),
      calendarKey(KEY_B64),
    );
    expect(verifyState(cal, key, NOW).ok).toBe(false);
    const mail = signState(newState({ orgId: 7, userId: 3, returnTo: '/email' }, NOW), key);
    expect(verifyState(mail, calendarKey(KEY_B64), NOW).ok).toBe(false);
  });

  it('the return address stays on the web app and carries the outcome', () => {
    expect(returnUrl('https://app.test/', '/email', 'connected')).toBe(
      'https://app.test/email?email=connected',
    );
    expect(returnUrl('https://app.test', '/email?tab=x', 'limit')).toBe(
      'https://app.test/email?tab=x&email=limit',
    );
    expect(returnUrl('https://app.test', '//evil.com', 'failed')).toBe(
      'https://app.test/email?email=failed',
    );
    expect(returnUrl('https://app.test', 'https://evil.com', 'failed')).toBe(
      'https://app.test/email?email=failed',
    );
  });
});
