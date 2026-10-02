import { describe, expect, it } from 'vitest';
import {
  backoffMs,
  CLOSE,
  closeLabel,
  decideClose,
  isMismatch,
  linkedDigits,
  shortStatus,
  type CloseInput,
} from '../../../src/modules/node-bridge-runtime/runtime/close-policy';
import {
  deviceStatusOf,
  statusLabel,
} from '../../../src/modules/node-bridge-runtime/runtime/device-status';

const zero = () => 0;
const input = (over: Partial<CloseInput>): CloseInput => ({
  code: undefined,
  everOpened: true,
  shuttingDown: false,
  retries: 0,
  random: zero,
  ...over,
});

describe('what a close means (WD-NODE-011 rule 7, one row per code)', () => {
  it('shutting down: nothing happens, whatever the code', () => {
    for (const code of [CLOSE.loggedOut, CLOSE.connectionClosed, undefined]) {
      expect(decideClose(input({ code, shuttingDown: true }))).toEqual({ action: 'ignore' });
    }
  });

  it('an opened device unlinked on the phone (401) or refused (403) stops for good', () => {
    expect(decideClose(input({ code: CLOSE.loggedOut }))).toEqual({ action: 'logged-out' });
    expect(decideClose(input({ code: CLOSE.forbidden }))).toEqual({ action: 'logged-out' });
  });

  it('a bad session (500) is wiped and reconnected from the QR', () => {
    expect(decideClose(input({ code: CLOSE.badSession }))).toEqual({
      action: 'reset-session',
      delayMs: 4_000,
    });
  });

  it('a first pairing that never opened fails with the reason, cut to 32 characters', () => {
    expect(decideClose(input({ code: CLOSE.connectionReplaced, everOpened: false }))).toEqual({
      action: 'abort-pair',
      status: 'Pair failed: connection replaced',
    });
    const long = decideClose(input({ code: 999, everOpened: false }));
    expect(long).toMatchObject({ action: 'abort-pair', status: 'Pair failed: code 999' });
    expect(shortStatus('Pair failed: a very long reason that does not fit')).toBe(
      'Pair failed: a very long reas...',
    );
    expect(shortStatus('Pair failed: a very long reason that does not fit')).toHaveLength(32);
  });

  it('but the restart after a successful scan (515) and a bad session (500) are not pairing failures', () => {
    expect(decideClose(input({ code: CLOSE.restartRequired, everOpened: false }))).toMatchObject({
      action: 'reconnect',
    });
    expect(decideClose(input({ code: CLOSE.badSession, everOpened: false }))).toMatchObject({
      action: 'reset-session',
    });
  });

  it('a first pairing refused as logged out or forbidden is a logout, not a pairing failure', () => {
    expect(decideClose(input({ code: CLOSE.loggedOut, everOpened: false }))).toEqual({
      action: 'logged-out',
    });
  });

  it('everything else reconnects for ever, saying "Syncing data" after a restart and "Reconnecting" otherwise', () => {
    expect(decideClose(input({ code: CLOSE.restartRequired }))).toEqual({
      action: 'reconnect',
      delayMs: 2_000,
      status: { label: 'Syncing data', progress: 75 },
    });
    for (const code of [
      CLOSE.timedOut,
      CLOSE.connectionClosed,
      CLOSE.connectionReplaced,
      CLOSE.unavailableService,
      undefined,
    ]) {
      expect(decideClose(input({ code }))).toMatchObject({
        action: 'reconnect',
        status: { label: 'Reconnecting', progress: 50 },
      });
    }
  });

  it('never gives up: the retry count only lengthens the wait', () => {
    expect(decideClose(input({ code: CLOSE.connectionClosed, retries: 5000 }))).toMatchObject({
      action: 'reconnect',
      delayMs: 30_000,
    });
  });
});

describe('backoff (WD-NODE-011 rule 8)', () => {
  it('starts from a base per code', () => {
    expect(backoffMs(CLOSE.restartRequired, 0, zero)).toBe(2_000);
    expect(backoffMs(CLOSE.badSession, 0, zero)).toBe(4_000);
    expect(backoffMs(CLOSE.connectionClosed, 0, zero)).toBe(4_000);
    expect(backoffMs(CLOSE.timedOut, 0, zero)).toBe(6_000);
    expect(backoffMs(CLOSE.connectionReplaced, 0, zero)).toBe(6_000);
    expect(backoffMs(undefined, 0, zero)).toBe(3_000);
  });
  it('grows by 1.5 per retry, at most tenfold, and never past 30 s', () => {
    expect(backoffMs(undefined, 1, zero)).toBe(4_500);
    expect(backoffMs(undefined, 2, zero)).toBe(6_750);
    expect(backoffMs(undefined, 100, zero)).toBe(30_000);
    expect(backoffMs(CLOSE.timedOut, 100, zero)).toBe(30_000);
  });
  it('adds up to 1.5 s of jitter', () => {
    expect(backoffMs(undefined, 0, () => 1)).toBe(4_500);
    expect(backoffMs(undefined, 0, () => 0.5)).toBe(3_750);
  });
});

describe('close reasons', () => {
  it('names a code, and lets a library message sharpen it', () => {
    expect(closeLabel(CLOSE.connectionReplaced)).toBe('connection replaced');
    expect(closeLabel(CLOSE.loggedOut)).toBe('logged out');
    expect(closeLabel(undefined)).toBe('connection lost');
    expect(closeLabel(CLOSE.connectionClosed, "Couldn't link device")).toBe('device limit reached');
    expect(closeLabel(CLOSE.connectionClosed, 'QR refs attempts ended')).toBe('QR expired');
    expect(closeLabel(undefined, 'Connection timed out')).toBe('timed out');
  });
});

describe('the linked account (WD-NODE-011 rule 6)', () => {
  it('reads the digits before the device suffix and the domain', () => {
    expect(linkedDigits('919876543210:12@s.whatsapp.net')).toBe('919876543210');
    expect(linkedDigits('919876543210@s.whatsapp.net')).toBe('919876543210');
    expect(linkedDigits(undefined)).toBe('');
  });
  it('flags a scan made with a different phone', () => {
    expect(isMismatch('919876543210:5@s.whatsapp.net', '+91 98765 43210')).toBe(false);
    expect(isMismatch('911111111111:5@s.whatsapp.net', '919876543210')).toBe(true);
    expect(isMismatch(undefined, '919876543210')).toBe(true);
  });
});

describe('status buckets (WD-NODE-012 rule 2)', () => {
  it.each([
    ['Ready', 'connected'],
    ['ready', 'connected'],
    ['Connected', 'connected'],
    ['paired', 'connected'],
    ['open', 'connected'],
    ['Logged Out', 'disconnected'],
    ['logged_out', 'disconnected'],
    ['Disconnected', 'disconnected'],
    ['Connection Failed', 'disconnected'],
    ['Pair failed: connection replaced', 'disconnected'],
    ['Mismatch', 'disconnected'],
    ['Connecting', 'needs_pair'],
    ['Syncing data', 'needs_pair'],
    ['Reconnecting', 'needs_pair'],
    ['Qr generated', 'needs_pair'],
    ['Code generated', 'needs_pair'],
    ['Ready to go', 'needs_pair'], // only the exact words count as connected
  ])('%s is %s', (label, expected) => expect(deviceStatusOf(label)).toBe(expected));

  it('every status the runtime reports maps to a label that buckets as intended', () => {
    expect(deviceStatusOf(statusLabel('open'))).toBe('connected');
    expect(deviceStatusOf(statusLabel('logged_out'))).toBe('disconnected');
    expect(deviceStatusOf(statusLabel('mismatch'))).toBe('disconnected');
    expect(deviceStatusOf(statusLabel('pair_failed', 'Pair failed: QR expired'))).toBe(
      'disconnected',
    );
    expect(deviceStatusOf(statusLabel('qr'))).toBe('needs_pair');
    expect(deviceStatusOf(statusLabel('reconnecting'))).toBe('needs_pair');
  });
});
