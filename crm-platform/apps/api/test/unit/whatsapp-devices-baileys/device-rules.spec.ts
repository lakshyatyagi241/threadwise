import { describe, expect, it } from 'vitest';
import { PERSONAL_WA_NOTICE_VERSION } from '@crm/contracts';
import {
  PAIRING_STARTS_PER_DEVICE_PER_HOUR,
  PILOT_DEVICE_CAP,
  blockedByOtherAttempt,
  deadlineMs,
  effectiveDeviceCap,
  guessRegion,
  isCurrentNotice,
  pairingRefusal,
  splitDevicePhone,
  toE164,
  windowVerdict,
  type AttemptRecord,
} from '../../../src/modules/whatsapp-devices-baileys/device-rules';

describe('phone normalisation (WaDesk splitPhone, WD-WADEV-005)', () => {
  it('+91 with "+91 76900 59356" strips the repeated country code', () => {
    expect(splitDevicePhone('+91', '+91 76900 59356')).toEqual({
      countryCode: '+91',
      phone: '7690059356',
      digits: '917690059356',
    });
  });

  it('a 10-digit number that happens to begin with 91 stays intact', () => {
    expect(splitDevicePhone('+91', '9123456789')).toEqual({
      countryCode: '+91',
      phone: '9123456789',
      digits: '919123456789',
    });
  });

  it('the prefix is stripped only when 9 or more digits remain (boundary)', () => {
    expect(splitDevicePhone('91', '91123456789')?.phone).toBe('123456789');
    expect(splitDevicePhone('91', '9112345678')?.phone).toBe('9112345678');
  });

  it('non-digits are removed from both parts and the country code is stored with a plus', () => {
    expect(splitDevicePhone('91', '(76900) 59-356')).toMatchObject({
      countryCode: '+91',
      phone: '7690059356',
    });
    expect(splitDevicePhone('  +1  ', '415 555 0132')).toMatchObject({
      countryCode: '+1',
      digits: '14155550132',
    });
  });

  it('is null when either part has no digits', () => {
    expect(splitDevicePhone('+', '123456')).toBeNull();
    expect(splitDevicePhone('+91', 'abc')).toBeNull();
  });

  it('region is guessed from the dial code when blank', () => {
    expect(
      ['+91', '+1', '+44', '+971', '+49', '+39', '+82', '+234', '+65'].map(guessRegion),
    ).toEqual(['IN', 'US', 'GB', 'AE', 'DE', 'IT', 'KR', 'NG', 'XX']);
  });

  it('shows the number as E.164', () => {
    expect(toE164('917690059356')).toBe('+917690059356');
  });
});

describe('the number cap (owner decision D3)', () => {
  it('is the smaller of the plan limit and the pilot cap; 0 (unlimited) does not lift the pilot cap', () => {
    expect(PILOT_DEVICE_CAP).toBe(2);
    expect(effectiveDeviceCap(0)).toBe(2);
    expect(effectiveDeviceCap(1)).toBe(1);
    expect(effectiveDeviceCap(2)).toBe(2);
    expect(effectiveDeviceCap(10)).toBe(2);
    expect(effectiveDeviceCap(10, 5)).toBe(5);
  });
});

describe('the pairable-state rule (spec 8.2, R1)', () => {
  const ok = { relink: false, sessionRows: 0 } as const;

  it.each(['created', 'disconnected', 'logged_out', 'error'] as const)(
    '%s with no saved session may start',
    (state) => {
      expect(pairingRefusal({ state, ...ok })).toBeNull();
    },
  );

  it('a saved session of 3 or more rows is never wiped without relink', () => {
    expect(pairingRefusal({ state: 'disconnected', sessionRows: 3, relink: false })).toBe(
      'healthy_session',
    );
    expect(pairingRefusal({ state: 'disconnected', sessionRows: 2, relink: false })).toBeNull();
    expect(pairingRefusal({ state: 'error', sessionRows: 9, relink: false })).toBe(
      'healthy_session',
    );
  });

  it('relink forgives a healthy session and a live state', () => {
    expect(pairingRefusal({ state: 'disconnected', sessionRows: 9, relink: true })).toBeNull();
    expect(pairingRefusal({ state: 'connecting', sessionRows: 9, relink: true })).toBeNull();
  });

  it.each(['awaiting_qr', 'awaiting_pairing_code', 'connecting'] as const)(
    '%s needs relink',
    (state) => {
      expect(pairingRefusal({ state, ...ok })).toBe('live_state');
      expect(pairingRefusal({ state, sessionRows: 0, relink: true })).toBeNull();
    },
  );

  it('a connected device is never re-paired, even with relink: disconnect it first', () => {
    expect(pairingRefusal({ state: 'connected', ...ok })).toBe('connected');
    expect(pairingRefusal({ state: 'connected', sessionRows: 9, relink: true })).toBe('connected');
  });
});

describe('one attempt at a time per device', () => {
  const attempt: AttemptRecord = {
    attempt: 'a',
    method: 'qr',
    startedByUserId: 1,
    startedAt: 1_000,
    deadlineAt: 91_000,
  };

  it('a second person is blocked while the first attempt is running', () => {
    expect(blockedByOtherAttempt({ attempt, state: 'awaiting_qr', userId: 2, now: 20_000 })).toBe(
      true,
    );
  });

  it('the same person may start again', () => {
    expect(blockedByOtherAttempt({ attempt, state: 'awaiting_qr', userId: 1, now: 20_000 })).toBe(
      false,
    );
  });

  it('nobody is blocked once the deadline passed, the state is not live, or there is no attempt', () => {
    expect(blockedByOtherAttempt({ attempt, state: 'awaiting_qr', userId: 2, now: 91_000 })).toBe(
      false,
    );
    expect(blockedByOtherAttempt({ attempt, state: 'error', userId: 2, now: 20_000 })).toBe(false);
    expect(
      blockedByOtherAttempt({ attempt: null, state: 'awaiting_qr', userId: 2, now: 20_000 }),
    ).toBe(false);
  });

  it('a QR attempt ends after 90 s and a code after 3 minutes', () => {
    expect(deadlineMs('qr')).toBe(90_000);
    expect(deadlineMs('code')).toBe(180_000);
  });
});

describe('the consent version check', () => {
  it('only the CURRENT version counts: a bump asks everybody again', () => {
    expect(isCurrentNotice(PERSONAL_WA_NOTICE_VERSION)).toBe(true);
    expect(isCurrentNotice('2026-01-01.1')).toBe(false);
    expect(isCurrentNotice('')).toBe(false);
  });
});

describe('fixed-window rate limit verdict', () => {
  it('allows up to the limit and refuses the next, with what is left of the window', () => {
    expect(windowVerdict(PAIRING_STARTS_PER_DEVICE_PER_HOUR, 5, 3_000, 3_600)).toEqual({
      allowed: true,
      retryAfterS: 3_000,
    });
    expect(windowVerdict(6, 5, 2_999, 3_600)).toEqual({ allowed: false, retryAfterS: 2_999 });
  });

  it('falls back to the whole window when the counter has no ttl yet', () => {
    expect(windowVerdict(6, 5, -1, 3_600).retryAfterS).toBe(3_600);
  });
});
