import { describe, expect, it } from 'vitest';
import { chooseContactPhone, sortForDisplayId } from '../transform/contacts';

// stand-in reader: a 12-digit national value reads as E.164, anything else does not
const read = (raw: string): string | null => (/^\d{12}$/.test(raw) ? `+${raw}` : null);

describe('chooseContactPhone', () => {
  it('keeps a valid WhatsApp number when the mobile field is unreadable', () => {
    expect(chooseContactPhone(['0981', '919812345678'], read)).toEqual({
      phone: '+919812345678',
      rejected: null,
    });
  });

  it('uses the mobile number first when it reads', () => {
    expect(chooseContactPhone(['919812345678', '919800000000'], read)).toEqual({
      phone: '+919812345678',
      rejected: null,
    });
  });

  it('reports the first rejected value when no candidate reads', () => {
    expect(chooseContactPhone(['12345', '987654'], read)).toEqual({
      phone: null,
      rejected: '12345',
    });
  });

  it('treats missing and empty values as nothing to report', () => {
    expect(chooseContactPhone([undefined, ''], read)).toEqual({ phone: null, rejected: null });
  });

  it('reports the WhatsApp value when the mobile field is empty', () => {
    expect(chooseContactPhone(['', '123'], read)).toEqual({ phone: null, rejected: '123' });
  });
});

describe('sortForDisplayId', () => {
  it('orders rows by Waboo _id (creation order) without touching the input', () => {
    const rows = [
      { legacy_id: '69cf6533e56b94f618025e65' },
      { legacy_id: '69b7eac7be0e6a93d3660e71' },
      { legacy_id: '69b7eac7be0e6a93d3660e70' },
    ];
    const out = sortForDisplayId(rows);
    expect(out.map((r) => r.legacy_id)).toEqual([
      '69b7eac7be0e6a93d3660e70',
      '69b7eac7be0e6a93d3660e71',
      '69cf6533e56b94f618025e65',
    ]);
    expect(rows[0]!.legacy_id).toBe('69cf6533e56b94f618025e65');
  });
});
