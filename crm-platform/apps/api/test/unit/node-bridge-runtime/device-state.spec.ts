import { describe, expect, it } from 'vitest';
import { DEVICE_STATE_REASONS } from '@crm/contracts';
import {
  connectionStateOf,
  deviceStatusOf,
  statusLabel,
  type RuntimeStatus,
} from '../../../src/modules/node-bridge-runtime/runtime/device-status';
import {
  QR_TTL_S,
  CODE_TTL_S,
  parseStoredQr,
} from '../../../src/modules/node-bridge-runtime/runtime/wa-redis';
import { senderDigits } from '../../../src/modules/node-bridge-runtime';

/**
 * The state machine's table (spec 8.1, 11.2): every runtime status maps to one connection_state with a reason code, and `status`
 * (what the senders read) stays what it always was. A blink is never "needs re-pair" (R3).
 */
describe('connectionStateOf: every runtime status', () => {
  const table: Array<[RuntimeStatus, string | undefined, string, string | null, string]> = [
    // status, label reason, state, reason, the unchanged three-valued `status`
    ['qr', undefined, 'awaiting_qr', null, 'needs_pair'],
    ['code', undefined, 'awaiting_pairing_code', null, 'needs_pair'],
    ['connecting', undefined, 'connecting', null, 'needs_pair'],
    ['syncing', undefined, 'connecting', null, 'needs_pair'],
    ['reconnecting', undefined, 'connecting', null, 'needs_pair'],
    ['open', undefined, 'connected', null, 'connected'],
    ['logged_out', undefined, 'logged_out', 'unlinked_on_phone', 'disconnected'],
    ['pair_failed', 'Pair failed: QR timeout', 'error', 'qr_timeout', 'disconnected'],
    ['pair_failed', 'Pair failed: QR expired', 'error', 'qr_timeout', 'disconnected'],
    [
      'pair_failed',
      'Pair failed: device limit reached',
      'error',
      'device_limit_reached',
      'disconnected',
    ],
    ['pair_failed', 'Pair failed: connection replaced', 'error', 'pair_failed', 'disconnected'],
    ['code_failed', 'Pairing failed: nope', 'error', 'code_failed', 'needs_pair'],
    ['mismatch', undefined, 'error', 'mismatch', 'disconnected'],
    ['disconnected', undefined, 'disconnected', 'user', 'disconnected'],
  ];
  it.each(table)('%s (%s) -> %s / %s, status %s', (status, reason, state, why, legacy) => {
    const v = connectionStateOf({ status, reason });
    expect(v).toEqual({ state, reason: why });
    // `status` is derived from the label exactly as before: the senders and dashboards read it unchanged.
    if (status !== 'code_failed') {
      expect(deviceStatusOf(statusLabel(status, reason))).toBe(legacy);
    }
  });

  it('an explicit reason wins (a 403 is forbidden, a swept session is session_incomplete)', () => {
    expect(connectionStateOf({ status: 'logged_out', stateReason: 'forbidden' })).toEqual({
      state: 'logged_out',
      reason: 'forbidden',
    });
    expect(
      connectionStateOf({ status: 'disconnected', stateReason: 'session_incomplete' }).reason,
    ).toBe('session_incomplete');
  });

  it('only closed reason codes are ever produced', () => {
    const statuses: RuntimeStatus[] = [
      'connecting',
      'syncing',
      'reconnecting',
      'qr',
      'code',
      'open',
      'logged_out',
      'pair_failed',
      'code_failed',
      'mismatch',
      'disconnected',
    ];
    for (const s of statuses) {
      const { reason } = connectionStateOf({ status: s, reason: 'Pair failed: something odd' });
      if (reason !== null) expect(DEVICE_STATE_REASONS).toContain(reason);
    }
  });

  it('there is no banned state: a refusal is reported as the link ending, never as a ban', () => {
    const v = connectionStateOf({ status: 'logged_out', stateReason: 'forbidden' });
    expect(v.state).toBe('logged_out');
    expect(JSON.stringify(v)).not.toMatch(/ban/i);
  });
});

describe('the QR and the pairing code in Redis', () => {
  it('the QR lives 45 s (it rotates about every 20 s) and the code its own 180 s validity', () => {
    expect(QR_TTL_S).toBe(45);
    expect(CODE_TTL_S).toBe(180);
  });

  it('a stored QR is { qr, at }; anything else reads as nothing', () => {
    expect(parseStoredQr(JSON.stringify({ qr: 'QR-1', at: 5 }))).toEqual({ qr: 'QR-1', at: 5 });
    expect(parseStoredQr('plain-old-qr-string')).toBeNull();
    expect(parseStoredQr(null)).toBeNull();
    expect(parseStoredQr('{"qr":1}')).toBeNull();
  });
});

describe('senderDigits (the digits the runtime links against)', () => {
  it('keeps WaDesk rules: country code in front unless the local number already carries it', () => {
    expect(senderDigits('+91', '7690059356')).toBe('917690059356');
    expect(senderDigits('+91', '917690059356')).toBe('917690059356');
    expect(senderDigits('91', '+917690059356')).toBe('917690059356');
  });

  it('a 10-digit number that merely begins with the country code is NOT one that carries it', () => {
    expect(senderDigits('+91', '9123456789')).toBe('919123456789');
    // Singapore: an 8-digit local number can start with the code (65).
    expect(senderDigits('+65', '65123456')).toBe('6565123456');
  });

  it('is empty when there is no number', () => {
    expect(senderDigits('+91', '')).toBe('');
    expect(senderDigits(null, null)).toBe('');
  });
});
