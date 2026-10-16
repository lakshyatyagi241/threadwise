import { describe, expect, it } from 'vitest';
import {
  failedSide,
  imapStepOf,
  okSide,
  reasonOf,
  smtpStepOf,
  testResult,
} from '../../../src/modules/channel-email/mail-test-rules';
import { syncLagSeconds } from '../../../src/modules/channel-email/mail-sync-rules';

const f = (kind: string, providerCode = '', message = 'said in our words') => ({
  kind,
  providerCode,
  message,
});

describe('reasonOf', () => {
  it('names the few reasons the screen words', () => {
    expect(reasonOf(f('auth_failed', 'imap'))).toBe('auth_failed');
    expect(reasonOf(f('unreachable', 'blocked_address'))).toBe('blocked_address');
    expect(reasonOf(f('unreachable', 'imap_tls'))).toBe('tls');
    expect(reasonOf(f('unreachable', 'smtp_tls'))).toBe('tls');
    expect(reasonOf(f('unreachable', 'imap_econnrefused'))).toBe('unreachable');
    expect(reasonOf(f('bad_request'))).toBe('rejected');
    expect(reasonOf(f('transient', 'imap_error'))).toBe('unknown');
  });
});

describe('steps', () => {
  it('a refused password is the login (IMAP) or the sign-in (SMTP); the rest is the connection', () => {
    expect(imapStepOf(f('auth_failed'), false)).toBe('login');
    expect(imapStepOf(f('unreachable'), false)).toBe('connect');
    expect(imapStepOf(f('transient'), true)).toBe('inbox');
    expect(smtpStepOf(f('auth_failed'))).toBe('auth');
    expect(smtpStepOf(f('unreachable'))).toBe('connect');
  });
});

describe('results', () => {
  it('a failed side carries its step, reason and sentence, never a count', () => {
    expect(
      failedSide(
        'login',
        f('auth_failed', 'imap', 'The IMAP server refused the username or password.'),
      ),
    ).toEqual({
      ok: false,
      failedStep: 'login',
      reason: 'auth_failed',
      message: 'The IMAP server refused the username or password.',
      inboxMessages: null,
    });
  });
  it('is ok only when both sides are', () => {
    expect(testResult(okSide(12), okSide()).ok).toBe(true);
    expect(testResult(okSide(12), failedSide('auth', f('auth_failed'))).ok).toBe(false);
    expect(testResult(failedSide('connect', f('unreachable')), okSide()).ok).toBe(false);
    expect(okSide(12)).toMatchObject({ ok: true, inboxMessages: 12, failedStep: null });
  });
});

describe('syncLagSeconds', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  it('is the whole seconds since the last sync of a connected mailbox', () => {
    expect(syncLagSeconds('connected', new Date('2026-10-16T11:58:30.900Z'), now)).toBe(89);
  });
  it('is null when never synced or not connected, and never negative', () => {
    expect(syncLagSeconds('connected', null, now)).toBeNull();
    expect(syncLagSeconds('needs_reauth', new Date('2026-10-16T11:00:00Z'), now)).toBeNull();
    expect(syncLagSeconds('disconnected', new Date('2026-10-16T11:00:00Z'), now)).toBeNull();
    expect(syncLagSeconds('connected', new Date('2026-10-16T12:00:05Z'), now)).toBe(0);
  });
});
