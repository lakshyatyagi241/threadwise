import { describe, expect, it } from 'vitest';
import {
  csvCell,
  toReferralRow,
} from '../../../src/modules/coupons-credits-referral-currency/referral.service';

describe('TW-CPN-036 CSV cells', () => {
  it('TW-CPN-036 quotes cells with commas, quotes and line breaks, and doubles inner quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(0)).toBe('0');
  });

  it('TW-CPN-036 a text cell that could run as a spreadsheet formula is neutralised with a leading quote', () => {
    for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx']) {
      expect(csvCell(bad, true).replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('=1+1')).toBe('=1+1');
  });
});

describe('TW-CPN-035 row status', () => {
  const base = {
    id: 1,
    uuid: '00000000-0000-4000-8000-000000000001',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    createdAtIso: '2026-10-01T00:00:00.000000Z',
    refereeName: 'A',
    refereeEmail: 'a@x.test',
    codeUsed: 'CODE',
    creditsAwarded: 0,
    walletTxUuid: null,
  };
  it('TW-CPN-035 a referral with credits awarded is paid, one without is pending (no payout, no wallet entry)', () => {
    expect(toReferralRow(base)).toMatchObject({
      status: 'pending',
      creditsAwardedMinor: 0,
      walletTxId: null,
    });
    expect(
      toReferralRow({
        ...base,
        creditsAwarded: 250,
        walletTxUuid: '00000000-0000-4000-8000-000000000002',
      }),
    ).toMatchObject({ status: 'paid', creditsAwardedMinor: 250 });
  });

  it('TW-CPN-035 the row never carries the internal id', () => {
    expect(JSON.stringify(toReferralRow(base))).not.toContain('"id":1');
  });
});
