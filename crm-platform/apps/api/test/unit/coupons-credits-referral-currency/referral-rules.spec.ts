import { describe, expect, it } from 'vitest';
import {
  REFERRAL_CODE_ALPHABET,
  majorString,
  moneyExponent,
  sanitizeReferralCode,
  toMinor,
  displayMinor,
} from '@crm/contracts';
import {
  csvCell,
  defaultBucket,
  deltaPct,
  generateReferralCode,
  initials,
  resolveRange,
  volumeSeries,
} from '../../../src/modules/coupons-credits-referral-currency/referral-rules';

describe('TW-CPN-029 referral code generation', () => {
  it('draws 10 characters from the confusion-free alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(10);
      for (const ch of code) expect(REFERRAL_CODE_ALPHABET).toContain(ch);
    }
    expect(REFERRAL_CODE_ALPHABET).not.toMatch(/[0OIL1]/);
  });

  it('is deterministic given its random source (so a collision can be re-drawn)', () => {
    let n = 0;
    expect(generateReferralCode(() => n++ % 31)).toBe('ABCDEFGHJK');
  });
});

describe('TW-CPN-030 the ?ref value', () => {
  it('keeps letters and digits, upper-cases, drops empty and over-long values', () => {
    expect(sanitizeReferralCode('abcd-1234')).toBe('ABCD1234');
    expect(sanitizeReferralCode('***')).toBeNull();
    expect(sanitizeReferralCode('A'.repeat(17))).toBeNull();
    expect(sanitizeReferralCode('A'.repeat(16))).toBe('A'.repeat(16));
    expect(sanitizeReferralCode(null)).toBeNull();
  });
});

describe('TW-CPN-035 history windows', () => {
  const now = new Date('2026-10-02T10:00:00Z');

  it('resolves the four ranges and falls back to 90 days', () => {
    expect(resolveRange('7d', now)).toMatchObject({ key: '7d', days: 7 });
    expect(resolveRange('30d', now)).toMatchObject({ key: '30d', days: 30 });
    expect(resolveRange('all', now)).toMatchObject({
      key: 'all',
      days: 1825,
      from: new Date('2020-01-01T00:00:00Z'),
    });
    expect(resolveRange('weird', now)).toMatchObject({ key: '90d', days: 90 });
    expect(resolveRange(undefined, now).to.getTime()).toBe(now.getTime() + 1000);
  });

  it('picks the default bucket by span: daily up to 14, weekly up to 90, else monthly', () => {
    expect(defaultBucket(7)).toBe('daily');
    expect(defaultBucket(30)).toBe('weekly');
    expect(defaultBucket(90)).toBe('weekly');
    expect(defaultBucket(1825)).toBe('monthly');
  });

  it('computes the delta against the previous window the way PHP rounds', () => {
    expect(deltaPct(5, 0)).toBe(100);
    expect(deltaPct(0, 0)).toBe(0);
    expect(deltaPct(3, 2)).toBe(50);
    expect(deltaPct(1, 3)).toBe(-67);
    expect(deltaPct(1, 8)).toBe(-88);
  });

  it('builds a daily series anchored to today: one point per day, labelled by weekday for a week', () => {
    const v = volumeSeries(
      [
        { at: new Date('2026-10-02T01:00:00Z'), creditsMinor: 100 },
        { at: new Date('2026-10-02T09:00:00Z'), creditsMinor: 0 },
        { at: new Date('2026-09-30T09:00:00Z'), creditsMinor: 250 },
      ],
      7,
      'daily',
      now,
    );
    expect(v.labels).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(v.signups).toEqual([0, 0, 0, 0, 1, 0, 2]);
    expect(v.creditsMinor).toEqual([0, 0, 0, 0, 250, 0, 100]);
  });

  it('a 90-day weekly series has ceil(90/7) = 13 Monday-anchored weeks; monthly has ceil(days/30) months', () => {
    const w = volumeSeries([], 90, 'weekly', now);
    expect(w.labels).toHaveLength(13);
    expect(w.labels[12]).toBe('Sep 28');
    const m = volumeSeries(
      [{ at: new Date('2026-08-15T00:00:00Z'), creditsMinor: 5 }],
      90,
      'monthly',
      now,
    );
    expect(m.labels).toEqual(['Aug', 'Sep', 'Oct']);
    expect(m.signups).toEqual([1, 0, 0]);
    expect(volumeSeries([], 90, 'daily', now).labels).toHaveLength(90);
  });
});

describe('TW-CPN-036 / 035 small helpers', () => {
  it('defuses spreadsheet formulas and quotes cells that need it', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(100)).toBe('100');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });

  it('makes initials from the first and last word, with a placeholder for nothing', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('Cher')).toBe('C');
    expect(initials('  ')).toBe('··');
    expect(initials('mary jane watson')).toBe('MW');
  });
});

describe('TW-CPN-028 minor-unit money helpers', () => {
  it('parses decimals into minor units by the real exponent', () => {
    expect(toMinor('15000', 'IDR')).toBe(15_000n);
    expect(toMinor('1.500', 'KWD')).toBe(1_500n);
    expect(toMinor('19.99', 'USD')).toBe(1_999n);
    expect(toMinor('1,500.50', 'USD')).toBe(150_050n);
    expect(toMinor('$19.99', 'USD')).toBe(1_999n);
    expect(toMinor('19.995', 'USD')).toBe(2_000n);
    expect(toMinor('', 'USD')).toBe(0n);
    expect(toMinor('-4.5', 'USD')).toBe(-450n);
  });

  it('formats minor units with separators and no symbol', () => {
    expect(majorString(150_000n, 'IDR')).toBe('150,000');
    expect(majorString(1_500n, 'KWD')).toBe('1.500');
    expect(majorString(5n, 'USD')).toBe('0.05');
    expect(majorString(-1_234_567n, 'USD')).toBe('-12,345.67');
  });

  it('knows Reference exponent table, with unknown codes at 2', () => {
    for (const c of ['JPY', 'IDR', 'HUF', 'TWD', 'MGA', 'VND']) expect(moneyExponent(c)).toBe(0);
    for (const c of ['KWD', 'BHD', 'OMR']) expect(moneyExponent(c)).toBe(3);
    for (const c of ['USD', 'EUR', 'XXX', '', null]) expect(moneyExponent(c)).toBe(2);
  });

  it('displays with the same exponent as it parses (the parity gap Reference had is closed)', () => {
    expect(displayMinor(1_500n, 'JPY')).toBe('JPY 1,500');
    expect(displayMinor(1_500n, 'KWD')).toBe('KWD 1.500');
    expect(displayMinor(150_000n, 'USD')).toBe('$1,500.00');
    expect(displayMinor(100n, 'ZZZ')).toBe('ZZZ 1.00');
  });
});
