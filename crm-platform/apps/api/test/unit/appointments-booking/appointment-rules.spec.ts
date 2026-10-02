import { describe, expect, it } from 'vitest';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import {
  assertActive,
  assertTransition,
  canMove,
  checkAnswers,
  generateManageToken,
  hashToken,
  inviteeFromAnswers,
  isActive,
  isFinal,
  looksLikeToken,
  money,
  percentToBp,
  priceInMinor,
  slugify,
  totalWithTax,
  type QuestionFacts,
} from '../../../src/modules/appointments-booking/appointment-rules';

describe('the status machine (EXT-APPT-04, D-04)', () => {
  const allowed: Array<[AppointmentStatus, AppointmentStatus]> = [
    ['pending', 'confirmed'],
    ['pending', 'declined'],
    ['pending', 'cancelled'],
    ['confirmed', 'cancelled'],
    ['confirmed', 'completed'],
    ['confirmed', 'no_show'],
  ];

  it('allows exactly the six moves and refuses every other pair', () => {
    for (const from of APPOINTMENT_STATUSES) {
      for (const to of APPOINTMENT_STATUSES) {
        const ok = allowed.some(([f, t]) => f === from && t === to);
        expect(canMove(from, to), `${from} -> ${to}`).toBe(ok);
      }
    }
  });

  it('the four final statuses have no way out; pending and confirmed hold the slot', () => {
    for (const s of ['cancelled', 'declined', 'completed', 'no_show'] as const) {
      expect(isFinal(s)).toBe(true);
      expect(isActive(s)).toBe(false);
    }
    expect(isActive('pending')).toBe(true);
    expect(isActive('confirmed')).toBe(true);
    expect(isFinal('pending')).toBe(false);
  });

  it('a refused move is 409 APPT_INVALID_TRANSITION naming from and to', () => {
    try {
      assertTransition('cancelled', 'confirmed');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.code).toBe('APPT_INVALID_TRANSITION');
      expect(err.getStatus()).toBe(409);
      expect(err.details).toEqual([
        { path: 'from', message: 'cancelled' },
        { path: 'to', message: 'confirmed' },
      ]);
    }
    expect(() => assertTransition('pending', 'confirmed')).not.toThrow();
    expect(() => assertActive('completed', 'reschedule')).toThrow(AppError);
    expect(() => assertActive('confirmed', 'reschedule')).not.toThrow();
  });
});

describe('money (D-11)', () => {
  const p = {
    currency: 'USD',
    fee: '100.00',
    taxPercent: '10',
    depositMode: 'full' as const,
    deposit: '0',
    cancelFee: '5',
    noShowFee: '0',
  };

  it('total is fee plus tax rounded half up to the minor unit; due now follows the deposit mode', () => {
    const full = priceInMinor(p);
    expect(full.totalMinor).toBe(11_000n);
    expect(full.dueNowMinor).toBe(11_000n);
    expect(priceInMinor({ ...p, depositMode: 'none' }).dueNowMinor).toBe(0n);
    expect(priceInMinor({ ...p, depositMode: 'partial', deposit: '25.50' }).dueNowMinor).toBe(
      2_550n,
    );
    expect(priceInMinor({ ...p, cancelFee: '5' }).cancelFeeMinor).toBe(500n);
  });

  it('rounds the tax half up: 0.05 at 10% is 0.005, which rounds to 0.01', () => {
    expect(totalWithTax(5n, percentToBp('10'))).toBe(6n);
    expect(totalWithTax(1_000n, percentToBp('12.5'))).toBe(1_125n);
    expect(totalWithTax(1_001n, percentToBp('12.5'))).toBe(1_126n); // 125.125 -> 125
    expect(percentToBp('100')).toBe(10_000);
    expect(percentToBp('7.05')).toBe(705);
  });

  it('the currency decides the decimals: JPY has none, KWD three, and too many is 422', () => {
    expect(
      priceInMinor({
        ...p,
        currency: 'JPY',
        fee: '1500',
        taxPercent: '0',
        depositMode: 'none',
        cancelFee: '0',
      }).feeMinor,
    ).toBe(1_500n);
    expect(
      priceInMinor({
        ...p,
        currency: 'KWD',
        fee: '1.250',
        taxPercent: '0',
        depositMode: 'none',
        cancelFee: '0',
      }).feeMinor,
    ).toBe(1_250n);
    expect(() => priceInMinor({ ...p, currency: 'JPY', fee: '1500.50' })).toThrow(AppError);
    expect(() => priceInMinor({ ...p, currency: 'USD', fee: '10.505' })).toThrow(AppError);
    expect(money(1_250n, 'KWD')).toBe('1.250');
    expect(money(1_500n, 'JPY')).toBe('1500');
    expect(money(11_000n, 'USD')).toBe('110.00');
  });

  it('a partial deposit above the price is refused (Reference allowed it)', () => {
    try {
      priceInMinor({ ...p, depositMode: 'partial', deposit: '500.00' });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('APPT_AMOUNT_INVALID');
    }
  });
});

describe('slugs and tokens (D-19)', () => {
  it('slugify: lower case, hyphens, accents folded, no leading or trailing hyphen', () => {
    expect(slugify('30-min Demo')).toBe('30-min-demo');
    expect(slugify('  Café — Consultation!! ')).toBe('cafe-consultation');
    expect(slugify('A'.repeat(200))).toHaveLength(80);
    expect(slugify('日本語')).toMatch(/^type-[0-9a-f]{6}$/);
  });
  it('a token is 43 base64url characters, unique, and only its SHA-256 is compared', () => {
    const a = generateManageToken();
    const b = generateManageToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(looksLikeToken(a)).toBe(true);
    expect(looksLikeToken('short')).toBe(false);
    expect(looksLikeToken(`${a}!`)).toBe(false);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toBe(hashToken(b));
    expect(hashToken(a)).toBe(hashToken(a));
  });
});

describe('answers (D-15)', () => {
  const q = (over: Partial<QuestionFacts>): QuestionFacts => ({
    id: crypto.randomUUID(),
    label: 'Q',
    type: 'text',
    options: null,
    required: true,
    mapToContactField: null,
    ...over,
  });

  it('a required question without an answer is refused, an optional one may be skipped', () => {
    const a = q({ label: 'Company' });
    const b = q({ label: 'Notes', required: false });
    expect(() => checkAnswers([a, b], {})).toThrow(AppError);
    expect(checkAnswers([a, b], { [a.id]: 'Acme' })).toEqual([
      { questionId: a.id, label: 'Company', type: 'text', value: 'Acme' },
    ]);
  });

  it('checks the format of each type and the choices of a select', () => {
    const email = q({ type: 'email' });
    const num = q({ type: 'number' });
    const date = q({ type: 'date' });
    const sel = q({ type: 'select', options: ['A', 'B'] });
    const phone = q({ type: 'phone' });
    const ok = checkAnswers([email, num, date, sel, phone], {
      [email.id]: 'a@b.co',
      [num.id]: '-3.5',
      [date.id]: '2026-02-28',
      [sel.id]: 'B',
      [phone.id]: '+91 98765 43210',
    });
    expect(ok).toHaveLength(5);
    for (const [question, bad] of [
      [email, 'nope'],
      [num, '3,5'],
      [date, '2026-02-30'],
      [sel, 'C'],
      [phone, '12'],
    ] as const) {
      try {
        checkAnswers([question], { [question.id]: bad });
        expect.unreachable(question.type);
      } catch (e) {
        expect((e as AppError).code).toBe('APPT_ANSWERS_INVALID');
        expect((e as AppError).getStatus()).toBe(422);
      }
    }
  });

  it('an answer to a question that is not of this service is refused', () => {
    const a = q({});
    expect(() => checkAnswers([a], { [a.id]: 'x', [crypto.randomUUID()]: 'y' })).toThrow(AppError);
  });

  it('answers fill the invitee fields they are mapped to', () => {
    const e = q({ type: 'email', mapToContactField: 'email' });
    const n = q({ mapToContactField: 'name' });
    const snaps = checkAnswers([e, n], { [e.id]: 'x@y.co', [n.id]: 'Zed' });
    expect(inviteeFromAnswers([e, n], snaps)).toEqual({ email: 'x@y.co', name: 'Zed' });
  });
});
