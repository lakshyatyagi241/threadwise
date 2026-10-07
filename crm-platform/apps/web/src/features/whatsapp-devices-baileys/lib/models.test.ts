import { describe, expect, it } from 'vitest';
import { capIndicator } from './cap-model';
import {
  POLL_INTERVAL_MS,
  POLL_SLOWDOWN_MS,
  QR_ROTATE_MS,
  attemptDeadlineMs,
  codeSecondsLeft,
  formatClock,
  failureKind,
  isTerminalPhase,
  nextPollDelay,
  pairingPhase,
  progressStrip,
  qrChanged,
  qrWindow,
  secondsUntil,
  type PairingSnapshot,
} from './pairing-model';
import {
  PAIRING_CODE_MIN_DIGITS,
  canUsePairingCode,
  formatPairingCode,
  readDevicePhone,
} from './phone-model';
import {
  CONNECTION_STATES,
  canDisconnect,
  canEditNumber,
  filterDevices,
  hasLiveLink,
  isConnectionState,
  isPairable,
  matchesFilter,
  primaryAction,
  reasonKey,
  stateBadge,
} from './state-model';
import {
  EMPTY_DRAFT,
  NO_ACKS,
  allAcknowledged,
  canContinue,
  firstStep,
  isDirty,
  nameProblem,
  numberProblems,
  tick,
} from './wizard-model';

describe('stateBadge', () => {
  it('has a pill for each of the eight states', () => {
    for (const s of CONNECTION_STATES) {
      const b = stateBadge(s);
      expect(b.labelKey).toBe(`state.${s}`);
    }
  });

  it('shows connected green, ended links red and every in-progress state amber', () => {
    expect(stateBadge('connected').tone).toBe('success');
    expect(stateBadge('logged_out').tone).toBe('danger');
    expect(stateBadge('error').tone).toBe('danger');
    for (const s of ['awaiting_qr', 'awaiting_pairing_code', 'connecting'])
      expect(stateBadge(s).tone).toBe('warning');
  });

  it('never reads "connecting" as needing a re-pair', () => {
    expect(primaryAction('connecting')).toBeNull();
    expect(stateBadge('connecting').labelKey).not.toContain('created');
  });

  it('reads a state from a newer server as neutral unknown, not as connected', () => {
    expect(stateBadge('quarantined')).toEqual({ tone: 'neutral', labelKey: 'state.unknown' });
    expect(isConnectionState('quarantined')).toBe(false);
  });
});

describe('state rules', () => {
  it('offers the right primary action per state', () => {
    expect(primaryAction('created')).toBe('link');
    expect(primaryAction('disconnected')).toBe('reconnect');
    expect(primaryAction('logged_out')).toBe('relink');
    expect(primaryAction('error')).toBe('retry');
    expect(primaryAction('connected')).toBeNull();
    expect(primaryAction('awaiting_qr')).toBeNull();
  });

  it('allows a pairing only from the pairable states (spec R1)', () => {
    expect(CONNECTION_STATES.filter(isPairable)).toEqual([
      'created',
      'disconnected',
      'logged_out',
      'error',
    ]);
  });

  it('disconnects any live link and locks the number while one exists', () => {
    expect(canDisconnect('connected')).toBe(true);
    expect(canDisconnect('connecting')).toBe(true);
    expect(canDisconnect('created')).toBe(false);
    expect(hasLiveLink('awaiting_pairing_code')).toBe(true);
    expect(canEditNumber('created')).toBe(true);
    expect(canEditNumber('connected')).toBe(false);
    expect(canEditNumber('disconnected')).toBe(false);
  });

  it('has words only for known reasons', () => {
    expect(reasonKey('qr_timeout')).toBe('reason.qr_timeout');
    expect(reasonKey('some_library_text')).toBeNull();
    expect(reasonKey(null)).toBeNull();
  });

  it('puts every non-live state in the Disconnected tab', () => {
    expect(matchesFilter('logged_out', 'disconnected')).toBe(true);
    expect(matchesFilter('created', 'disconnected')).toBe(true);
    expect(matchesFilter('connecting', 'disconnected')).toBe(false);
    expect(matchesFilter('connected', 'connected')).toBe(true);
    expect(matchesFilter('error', 'all')).toBe(true);
  });

  it('searches by name or by digits of the number', () => {
    const rows = [
      { name: 'Sales line', phone: '+919876543210', connectionState: 'connected' },
      { name: 'Support', phone: '+14155550123', connectionState: 'created' },
    ];
    expect(filterDevices(rows, 'all', 'sales')).toHaveLength(1);
    expect(filterDevices(rows, 'all', '+91 98765')).toHaveLength(1);
    expect(filterDevices(rows, 'connected', '4155')).toHaveLength(0);
    expect(filterDevices(rows, 'all', '  ')).toHaveLength(2);
    expect(filterDevices(rows, 'all', 'zzz')).toHaveLength(0);
  });
});

describe('capIndicator', () => {
  it('shows N of the cap and is full at the cap', () => {
    expect(capIndicator(1, 2)).toEqual({ used: 1, limit: 2, full: false, remaining: 1 });
    expect(capIndicator(2, 2)).toEqual({ used: 2, limit: 2, full: true, remaining: 0 });
    expect(capIndicator(3, 2).full).toBe(true);
  });

  it('shows no cap for a missing, zero or negative limit', () => {
    for (const l of [null, undefined, 0, -1, Number.NaN]) {
      expect(capIndicator(5, l)).toEqual({ used: 5, limit: null, full: false, remaining: null });
    }
  });

  it('treats a bad count as zero', () => {
    expect(capIndicator(-3, 2).used).toBe(0);
    expect(capIndicator(Number.NaN, 2).used).toBe(0);
  });
});

describe('phone', () => {
  it('splits a valid E.164 number into dial code, national digits and region', () => {
    const p = readDevicePhone('+91 76900 59356');
    expect(p).toMatchObject({
      ok: true,
      e164: '+917690059356',
      digits: '917690059356',
      callingCode: '91',
      nationalDigits: '7690059356',
      region: 'IN',
    });
  });

  it('keeps a national number that starts with the dial code digits intact', () => {
    // Reference's own example: a 10-digit number that begins with 91 stays whole.
    const p = readDevicePhone('+919123456789');
    expect(p).toMatchObject({ ok: true, callingCode: '91', nationalDigits: '9123456789' });
  });

  it('rejects empty and invalid numbers with a reason', () => {
    expect(readDevicePhone(null)).toEqual({ ok: false, problem: 'empty' });
    expect(readDevicePhone('  ')).toEqual({ ok: false, problem: 'empty' });
    expect(readDevicePhone('+91 123')).toEqual({ ok: false, problem: 'invalid' });
    expect(readDevicePhone('not a number')).toEqual({ ok: false, problem: 'invalid' });
  });

  it('needs at least 8 digits, country code included, for a pairing code', () => {
    expect(PAIRING_CODE_MIN_DIGITS).toBe(8);
    expect(canUsePairingCode(readDevicePhone('+917690059356'))).toBe(true);
    expect(canUsePairingCode({ ok: false, problem: 'empty' })).toBe(false);
  });

  it('shows the code as XXXX-XXXX', () => {
    expect(formatPairingCode('abcd1234')).toBe('ABCD-1234');
    expect(formatPairingCode('ABCD-1234')).toBe('ABCD-1234');
    expect(formatPairingCode('SHORT')).toBe('SHORT');
  });
});

describe('pairing phase and polling', () => {
  const now = Date.parse('2026-10-07T10:00:00Z');
  const future = new Date(now + 60_000).toISOString();
  const snap = (over: Partial<PairingSnapshot>): PairingSnapshot => ({
    state: 'awaiting_qr',
    qr: 'qr-string',
    deadlineAt: future,
    ...over,
  });

  it('is starting until the start call answered or a QR exists', () => {
    expect(pairingPhase(null, now)).toBe('starting');
    expect(pairingPhase(snap({}), now, false)).toBe('starting');
    expect(pairingPhase(snap({ qr: null }), now)).toBe('starting');
  });

  it('follows the state machine', () => {
    expect(pairingPhase(snap({}), now)).toBe('waiting_scan');
    expect(
      pairingPhase(snap({ state: 'awaiting_pairing_code', qr: null, code: 'ABCD1234' }), now),
    ).toBe('waiting_code');
    expect(pairingPhase(snap({ state: 'connecting' }), now)).toBe('linking');
    expect(pairingPhase(snap({ state: 'connected' }), now)).toBe('connected');
    expect(pairingPhase(snap({ state: 'error', reason: 'mismatch' }), now)).toBe('failed');
    expect(pairingPhase(snap({ state: 'logged_out' }), now)).toBe('failed');
  });

  it('expires at the deadline without waiting for the next poll', () => {
    const past = new Date(now - 1).toISOString();
    expect(pairingPhase(snap({ deadlineAt: past }), now)).toBe('expired');
    // but a link that is already syncing is not cut by the clock
    expect(pairingPhase(snap({ state: 'connecting', deadlineAt: past }), now)).toBe('linking');
  });

  it('counts the attempt on the local clock so a wrong computer clock cannot end it early', () => {
    // The server's deadline is a minute away by ITS clock, but this computer's clock is 10 minutes ahead.
    const skewedNow = now + 10 * 60_000;
    const first = { startedAt: new Date(now - 5000).toISOString(), deadlineAt: future };
    expect(pairingPhase(snap({}), skewedNow)).toBe('expired');
    const deadline = attemptDeadlineMs(first, skewedNow);
    expect(deadline).toBe(skewedNow + 65_000);
    expect(pairingPhase(snap({}), skewedNow + 30_000, true, deadline)).toBe('waiting_scan');
    expect(pairingPhase(snap({}), skewedNow + 66_000, true, deadline)).toBe('expired');
    expect(attemptDeadlineMs({ startedAt: null, deadlineAt: future }, 0)).toBeNull();
    expect(attemptDeadlineMs({ startedAt: future, deadlineAt: future }, 0)).toBeNull();
  });

  it('counts whole seconds to the deadline and never below zero', () => {
    expect(secondsUntil(future, now)).toBe(60);
    expect(secondsUntil(new Date(now - 5000).toISOString(), now)).toBe(0);
    expect(secondsUntil(null, now)).toBeNull();
    expect(secondsUntil('nonsense', now)).toBeNull();
    expect(secondsUntil(now + 4500, now)).toBe(5);
  });

  it('polls every 2 seconds while the dialog is open, visible and waiting', () => {
    expect(POLL_INTERVAL_MS).toBe(2000);
    expect(nextPollDelay({ open: true, hidden: false, phase: 'waiting_scan' })).toBe(2000);
    expect(nextPollDelay({ open: true, hidden: false, phase: 'starting' })).toBe(2000);
    expect(nextPollDelay({ open: true, hidden: false, phase: 'linking' })).toBe(2000);
  });

  it('backs off after a 429 on the read instead of failing', () => {
    expect(
      nextPollDelay({ open: true, hidden: false, phase: 'waiting_scan', rateLimited: true }),
    ).toBe(POLL_SLOWDOWN_MS);
    expect(POLL_SLOWDOWN_MS).toBeGreaterThan(POLL_INTERVAL_MS);
    expect(
      nextPollDelay({ open: false, hidden: false, phase: 'waiting_scan', rateLimited: true }),
    ).toBe(false);
  });

  it('stops when the dialog closes, when the tab is hidden and when the attempt ended', () => {
    expect(nextPollDelay({ open: false, hidden: false, phase: 'waiting_scan' })).toBe(false);
    expect(nextPollDelay({ open: true, hidden: true, phase: 'waiting_scan' })).toBe(false);
    for (const phase of ['connected', 'expired', 'failed'] as const) {
      expect(isTerminalPhase(phase)).toBe(true);
      expect(nextPollDelay({ open: true, hidden: false, phase })).toBe(false);
    }
  });

  it('runs the QR ring over its 20-second window and restarts on a new QR', () => {
    expect(qrWindow(0, 1000, 1000)).toEqual({ seconds: 20, fraction: 1 });
    expect(qrWindow(5000, 1000, 6000)).toEqual({ seconds: 10, fraction: 0.5 });
    expect(qrWindow(QR_ROTATE_MS + 3000, 0, 0)).toEqual({ seconds: 0, fraction: 0 });
    expect(qrWindow(undefined, 0, 0).seconds).toBe(20);
    expect(qrChanged('a', 'a')).toBe(false);
    expect(qrChanged('a', 'b')).toBe(true);
    expect(qrChanged(null, undefined)).toBe(false);
  });

  it('formats clocks and runs the code validity from when it arrived', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(-3)).toBe('0:00');
    expect(codeSecondsLeft(180, 1000, 1000)).toBe(180);
    expect(codeSecondsLeft(180, 1000, 31_000)).toBe(150);
    expect(codeSecondsLeft(10, 0, 60_000)).toBe(0);
    expect(codeSecondsLeft(null, 0, 0)).toBeNull();
  });

  it('fills the strip Code shown, Scanned, Ready', () => {
    expect(progressStrip('waiting_scan')).toEqual({
      shown: 'current',
      scanned: 'todo',
      ready: 'todo',
    });
    expect(progressStrip('linking').scanned).toBe('current');
    expect(progressStrip('connected')).toEqual({ shown: 'done', scanned: 'done', ready: 'done' });
  });

  it('maps endings to outcomes without ever saying banned', () => {
    expect(failureKind('expired', 'awaiting_qr', null)).toBe('timedOut');
    expect(failureKind('failed', 'error', 'qr_timeout')).toBe('timedOut');
    expect(failureKind('failed', 'logged_out', 'forbidden')).toBe('loggedOut');
    expect(failureKind('failed', 'error', 'session_conflict')).toBe('replaced');
    expect(failureKind('failed', 'error', 'mismatch')).toBe('mismatch');
    expect(failureKind('failed', 'error', 'device_limit_reached')).toBe('limit');
    expect(failureKind('failed', 'disconnected', 'worker_silent')).toBe('phoneOffline');
    expect(failureKind('failed', 'error', 'worker_unavailable')).toBe('service');
    expect(failureKind('failed', 'error', 'proxy_unreachable')).toBe('proxy');
    expect(failureKind('failed', 'error', null)).toBe('failed');
  });
});

describe('wizard guards', () => {
  it('needs all three acknowledgements, none pre-ticked', () => {
    expect(allAcknowledged(NO_ACKS)).toBe(false);
    expect(allAcknowledged([true, true, false])).toBe(false);
    expect(allAcknowledged([true, true, true])).toBe(true);
    expect(tick(NO_ACKS, 1, true)).toEqual([false, true, false]);
    expect(canContinue('notice', { ...EMPTY_DRAFT, acks: tick(NO_ACKS, 0, true) })).toBe(false);
    expect(canContinue('notice', { ...EMPTY_DRAFT, acks: [true, true, true] })).toBe(true);
  });

  it('opens at the right step', () => {
    expect(firstStep({ noticeAccepted: false, existingDevice: false })).toBe('notice');
    expect(firstStep({ noticeAccepted: false, existingDevice: true })).toBe('notice');
    expect(firstStep({ noticeAccepted: true, existingDevice: false })).toBe('number');
    expect(firstStep({ noticeAccepted: true, existingDevice: true })).toBe('link');
  });

  it('checks the name between 2 and 191 characters', () => {
    expect(nameProblem('')).toBe('required');
    expect(nameProblem('  ')).toBe('required');
    expect(nameProblem('a')).toBe('short');
    expect(nameProblem('ab')).toBeNull();
    expect(nameProblem('x'.repeat(191))).toBeNull();
    expect(nameProblem('x'.repeat(192))).toBe('long');
  });

  it('needs a valid name and number to leave the number step', () => {
    const base = { ...EMPTY_DRAFT, acks: [true, true, true] as const };
    expect(canContinue('number', base)).toBe(false);
    expect(numberProblems({ ...base, name: 'Sales', e164: null })).toEqual({
      name: null,
      phone: 'empty',
    });
    expect(numberProblems({ ...base, name: 'Sales', e164: null, phoneInvalid: true }).phone).toBe(
      'invalid',
    );
    expect(canContinue('number', { ...base, name: 'Sales', e164: '+917690059356' })).toBe(true);
    expect(canContinue('link', base)).toBe(false);
  });

  it('asks before closing only when there is something to lose', () => {
    const idle = {
      draft: EMPTY_DRAFT,
      step: 'notice' as const,
      attemptActive: false,
      deviceCreated: false,
    };
    expect(isDirty(idle)).toBe(false);
    expect(isDirty({ ...idle, draft: { ...EMPTY_DRAFT, acks: tick(NO_ACKS, 0, true) } })).toBe(
      true,
    );
    expect(isDirty({ ...idle, step: 'number', draft: { ...EMPTY_DRAFT, name: 'Sales' } })).toBe(
      true,
    );
    expect(isDirty({ ...idle, step: 'link', attemptActive: true, deviceCreated: true })).toBe(true);
    expect(
      isDirty({ ...idle, step: 'link', deviceCreated: true, draft: { ...EMPTY_DRAFT, name: 'x' } }),
    ).toBe(false);
    expect(isDirty({ ...idle, step: 'done', attemptActive: true })).toBe(false);
  });
});
